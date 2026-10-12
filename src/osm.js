import { setTimeout as sleep } from 'node:timers/promises';

import { log } from '@crawlee/cheerio';

import { BUSINESS_KEYS, resolveCategory } from './categories.js';

const USER_AGENT = 'apify-local-business-finder/0.1 (+https://apify.com)';

const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function fetchJson(url, { method = 'GET', body, timeoutMs = 30_000 } = {}) {
    const response = await fetch(url, {
        method,
        body,
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    return response.json();
}

async function geocodeNominatim(location) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(location)}`;
    const results = await fetchJson(url);
    if (!Array.isArray(results) || !results.length) return null;
    // An administrative relation gives exact city limits; otherwise fall back to the bounding box.
    const hit = results.find((r) => r.osm_type === 'relation') ?? results[0];
    const [south, north, west, east] = (hit.boundingbox ?? []).map(Number);
    return {
        displayName: hit.display_name,
        areaId: hit.osm_type === 'relation' ? 3_600_000_000 + Number(hit.osm_id) : null,
        bbox: [south, west, north, east].every(Number.isFinite) ? [south, west, north, east] : null,
    };
}

async function geocodePhoton(location) {
    const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(location)}`;
    const result = await fetchJson(url);
    const feature = result?.features?.[0];
    if (!feature) return null;
    const p = feature.properties ?? {};
    // Photon extent order: [west, north, east, south]
    const [west, north, east, south] = p.extent ?? [];
    let bbox = [south, west, north, east];
    if (!bbox.every(Number.isFinite)) {
        const [lon, lat] = feature.geometry?.coordinates ?? [];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        bbox = [lat - 0.05, lon - 0.05, lat + 0.05, lon + 0.05];
    }
    return {
        displayName: [p.name, p.state, p.country].filter(Boolean).join(', '),
        areaId: p.osm_type === 'R' ? 3_600_000_000 + Number(p.osm_id) : null,
        bbox,
    };
}

export async function geocode(location) {
    for (const [name, fn] of [['Nominatim', geocodeNominatim], ['Photon', geocodePhoton]]) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const place = await fn(location);
                if (place) return place;
                break;
            } catch (err) {
                log.warning(`Geocoding "${location}" with ${name} failed (attempt ${attempt}): ${err.message}`);
                await sleep(1500);
            }
        }
    }
    return null;
}

function escapeRegex(text) {
    return text.replace(/["\\]/g, '').replace(/[.*+?^${}()|[\]]/g, '\\$&');
}

function tagStatements({ tags }, areaFilter) {
    return tags.map(([k, v]) => `nwr["${k}"="${v}"]["name"]${areaFilter};`);
}

function nameStatements({ tags, keyword }, areaFilter) {
    const kw = escapeRegex(keyword);
    if (kw.length < 3) return [];
    const asTagValue = kw.replace(/\s+/g, '_');
    const statements = [];
    for (const key of BUSINESS_KEYS) {
        statements.push(`nwr["name"~"${kw}",i]["${key}"]${areaFilter};`);
        if (!tags.length) statements.push(`nwr["${key}"~"${asTagValue}",i]["name"]${areaFilter};`);
    }
    return statements;
}

function wrapQuery(statements, prelude, limit) {
    return `[out:json][timeout:40];${prelude}(${statements.join('')});out tags center ${limit};`;
}

// Public Overpass servers are often overloaded, so endpoints that keep failing are skipped for the rest of the run.
const endpointFailures = new Map();

async function runOverpass(query, budgetMs) {
    const deadline = Date.now() + budgetMs;
    let lastError = new Error('No Overpass endpoint available');
    const endpoints = [...OVERPASS_ENDPOINTS].sort((x, y) => (endpointFailures.get(x) ?? 0) - (endpointFailures.get(y) ?? 0));
    for (const endpoint of endpoints) {
        const msLeft = deadline - Date.now();
        if (msLeft < 5000) break;
        try {
            const data = await fetchJson(endpoint, {
                method: 'POST',
                body: `data=${encodeURIComponent(query)}`,
                timeoutMs: Math.min(45_000, msLeft),
            });
            // A timed-out query still answers 200, with a remark and no elements.
            if (Array.isArray(data?.elements) && (data.elements.length || !data.remark)) return data.elements;
            lastError = new Error(data?.remark ?? 'Unexpected Overpass response');
            log.warning(`Overpass endpoint ${new URL(endpoint).hostname} failed: ${lastError.message}`);
        } catch (err) {
            lastError = err;
            log.warning(`Overpass endpoint ${new URL(endpoint).hostname} failed: ${err.message}`);
        }
        endpointFailures.set(endpoint, (endpointFailures.get(endpoint) ?? 0) + 1);
    }
    throw lastError;
}

async function searchOverpass(category, place, limit) {
    const scopes = [];
    if (place.areaId) scopes.push(['(area.a)', `area(${place.areaId})->.a;`]);
    if (place.bbox) scopes.push([`(${place.bbox.join(',')})`, '']);

    const elements = [];
    for (const [areaFilter, prelude] of scopes) {
        const tagQuery = tagStatements(category, areaFilter);
        if (tagQuery.length) elements.push(...(await runOverpass(wrapQuery(tagQuery, prelude, limit), 75_000)));

        // Matching by business name is a bonus on top of the category match, so a failure here is not fatal.
        const nameQuery = nameStatements(category, areaFilter);
        if (nameQuery.length) {
            try {
                elements.push(...(await runOverpass(wrapQuery(nameQuery, prelude, limit), tagQuery.length ? 40_000 : 75_000)));
            } catch (err) {
                if (!elements.length) throw err;
                log.warning(`Name search skipped: ${err.message}`);
            }
        }
        if (elements.length) break;
    }
    return elements;
}

// Slower and smaller than Overpass (40 results per request), but served from different infrastructure.
async function searchNominatim(category, place, maxResults) {
    if (!place.bbox) return [];
    const [south, west, north, east] = place.bbox;
    const phrases = category.tags.map(([key, value]) => (key === 'shop' ? `${value.replace(/_/g, ' ')} shop` : value.replace(/_/g, ' ')));
    if (category.keyword.length >= 3) phrases.push(category.keyword);

    const elements = [];
    const seenPlaceIds = [];
    for (const phrase of [...new Set(phrases)]) {
        for (let page = 0; page < 5 && elements.length < maxResults; page++) {
            const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&extratags=1&addressdetails=1'
                + `&q=${encodeURIComponent(phrase)}&viewbox=${west},${north},${east},${south}&bounded=1`
                + (seenPlaceIds.length ? `&exclude_place_ids=${seenPlaceIds.join(',')}` : '');
            await sleep(1100);
            let results;
            try {
                results = await fetchJson(url);
            } catch (err) {
                log.warning(`Fallback search for "${phrase}" failed: ${err.message}`);
                break;
            }
            if (!Array.isArray(results) || !results.length) break;
            for (const r of results) {
                seenPlaceIds.push(r.place_id);
                if (!r.name || !BUSINESS_KEYS.includes(r.category)) continue;
                const addr = r.address ?? {};
                elements.push({
                    type: r.osm_type,
                    id: r.osm_id,
                    lat: Number(r.lat),
                    lon: Number(r.lon),
                    tags: {
                        'addr:housenumber': addr.house_number,
                        'addr:street': addr.road,
                        'addr:city': addr.city ?? addr.town ?? addr.village ?? addr.suburb,
                        'addr:state': addr.state,
                        'addr:postcode': addr.postcode,
                        'addr:country': addr.country_code?.toUpperCase(),
                        ...(r.extratags ?? {}),
                        name: r.name,
                        [r.category]: r.type,
                    },
                });
            }
            if (results.length < 40) break;
        }
    }
    return elements;
}

function splitValues(value) {
    return String(value ?? '')
        .split(/[;,]/)
        .map((v) => v.trim())
        .filter(Boolean);
}

function normalizeWebsite(raw) {
    if (!raw) return null;
    let url = String(raw).split(';')[0].trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    try {
        return new URL(url).href;
    } catch {
        return null;
    }
}

function socialUrl(value, base) {
    if (!value) return null;
    const v = String(value).trim();
    if (/^https?:\/\//i.test(v)) return v;
    return `${base}${v.replace(/^@/, '')}`;
}

function toBusiness(element, context) {
    const t = element.tags ?? {};
    const lat = element.lat ?? element.center?.lat ?? null;
    const lon = element.lon ?? element.center?.lon ?? null;

    const categoryKey = BUSINESS_KEYS.find((k) => t[k]);
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const city = t['addr:city'] ?? null;
    const address = [street, city, [t['addr:state'], t['addr:postcode']].filter(Boolean).join(' '), t['addr:country']]
        .filter(Boolean)
        .join(', ');

    const phones = [...new Set([...splitValues(t.phone), ...splitValues(t['contact:phone']), ...splitValues(t['contact:mobile'])])];
    const emails = [...new Set([...splitValues(t.email), ...splitValues(t['contact:email'])].map((e) => e.toLowerCase()))];

    const socialLinks = {};
    const facebook = socialUrl(t['contact:facebook'] ?? t.facebook, 'https://www.facebook.com/');
    const instagram = socialUrl(t['contact:instagram'] ?? t.instagram, 'https://www.instagram.com/');
    const twitter = socialUrl(t['contact:twitter'] ?? t.twitter, 'https://twitter.com/');
    const linkedin = socialUrl(t['contact:linkedin'], 'https://www.linkedin.com/company/');
    if (facebook) socialLinks.facebook = facebook;
    if (instagram) socialLinks.instagram = instagram;
    if (twitter) socialLinks.twitter = twitter;
    if (linkedin) socialLinks.linkedin = linkedin;

    const mapsQuery = encodeURIComponent([t.name, address || context.locationName].filter(Boolean).join(', '));

    return {
        id: `${element.type}/${element.id}`,
        name: t.name,
        category: categoryKey ? t[categoryKey].replace(/_/g, ' ') : null,
        categoryTag: categoryKey ? `${categoryKey}=${t[categoryKey]}` : null,
        brand: t.brand ?? null,
        address: address || null,
        street: street || null,
        city,
        state: t['addr:state'] ?? null,
        postcode: t['addr:postcode'] ?? null,
        country: t['addr:country'] ?? null,
        latitude: lat,
        longitude: lon,
        phone: phones[0] ?? null,
        phones,
        website: normalizeWebsite(t.website ?? t['contact:website'] ?? t.url),
        emails,
        socialLinks,
        openingHours: t.opening_hours ?? null,
        cuisine: t.cuisine ? splitValues(t.cuisine) : null,
        wheelchair: t.wheelchair ?? null,
        description: t.description ?? null,
        osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
        searchTerm: context.searchTerm,
        location: context.locationName,
        source: 'OpenStreetMap',
    };
}

function completeness(b) {
    return (b.website ? 3 : 0) + (b.phone ? 2 : 0) + (b.emails.length ? 2 : 0) + (b.street ? 1 : 0) + (b.openingHours ? 1 : 0);
}

/**
 * Returns businesses of the given type inside the geocoded place, most complete listings first.
 */
export async function findBusinesses({ searchTerm, place, locationName, maxResults }) {
    const category = resolveCategory(searchTerm);
    if (!category.tags.length && category.keyword.length < 3) {
        throw new Error(`Search term "${searchTerm}" is too short to search for`);
    }
    log.info(`Searching "${searchTerm}" in ${locationName}`, {
        tags: category.tags.map(([k, v]) => `${k}=${v}`),
        nameKeyword: category.keyword,
    });

    const fetchLimit = Math.min(Math.max(maxResults * 4, 200), 3000);
    let elements = [];
    try {
        elements = await searchOverpass(category, place, fetchLimit);
    } catch (err) {
        log.warning(`Overpass search failed (${err.message}), using the fallback search.`);
    }
    if (!elements.length) elements = await searchNominatim(category, place, maxResults);

    const seen = new Set();
    const businesses = [];
    for (const element of elements) {
        if (!element.tags?.name) continue;
        const business = toBusiness(element, { searchTerm, locationName });
        const dedupeKey = `${business.name.toLowerCase()}|${(business.address ?? business.id).toLowerCase()}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        businesses.push(business);
    }

    businesses.sort((a, b) => completeness(b) - completeness(a));
    return businesses.slice(0, maxResults);
}
