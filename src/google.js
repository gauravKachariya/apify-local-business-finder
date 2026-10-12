import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { log } from '@crawlee/cheerio';

// The gosom/google-maps-scraper binary shipped in the actor's Docker image.
const ENGINE_PATH = process.env.GMAPS_ENGINE_PATH ?? '/usr/bin/google-maps-scraper';

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export async function isEngineAvailable() {
    try {
        await access(ENGINE_PATH);
        return true;
    } catch {
        return false;
    }
}

function killTree(child) {
    for (const signal of ['SIGTERM', 'SIGKILL']) {
        try {
            // Negative pid targets the whole process group, so the browser processes go too.
            process.kill(-child.pid, signal);
        } catch {
            try {
                child.kill(signal);
            } catch {
                // already gone
            }
        }
        if (signal === 'SIGTERM' && child.exitCode !== null) return;
    }
}

function runEngine(args, budgetMs) {
    return new Promise((resolve) => {
        const lastLines = [];
        const child = spawn(ENGINE_PATH, args, {
            detached: true,
            stdio: ['ignore', 'ignore', 'pipe'],
            env: { ...process.env, DISABLE_TELEMETRY: '1' },
        });
        const timer = setTimeout(() => {
            log.warning('Google Maps search reached its time budget, keeping what was collected so far.');
            killTree(child);
        }, budgetMs);

        child.stderr.on('data', (chunk) => {
            for (const line of String(chunk).split('\n')) {
                if (!line.trim()) continue;
                lastLines.push(line.trim().slice(0, 300));
                if (lastLines.length > 5) lastLines.shift();
                log.debug(`[gmaps] ${line.trim().slice(0, 300)}`);
            }
        });
        const done = (code) => {
            clearTimeout(timer);
            resolve({ code, lastLines });
        };
        child.on('error', (err) => {
            lastLines.push(err.message);
            done(-1);
        });
        child.on('close', done);
    });
}

function parseResults(text) {
    const entries = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) entries.push(...parsed);
            else entries.push(parsed);
        } catch {
            // a line cut off when the engine was stopped
        }
    }
    return entries;
}

function cleanWebsite(raw) {
    if (!raw) return null;
    let url = String(raw).trim();
    try {
        // Google sometimes wraps the site in a redirect link.
        if (/^https?:\/\/(www\.)?google\.[a-z.]+\/url\?/i.test(url)) url = new URL(url).searchParams.get('q') ?? url;
        if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
        return new URL(url).href;
    } catch {
        return null;
    }
}

function formatOpenHours(openHours) {
    if (!openHours || typeof openHours !== 'object') return null;
    const days = Object.keys(openHours).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
    const parts = days.map((day) => `${day}: ${[].concat(openHours[day] ?? []).join(', ')}`);
    return parts.length ? parts.join('; ') : null;
}

function toBusiness(entry, context) {
    const addr = entry.complete_address ?? {};
    const phones = entry.phone ? [String(entry.phone).trim()] : [];
    const longitude = entry.longitude ?? entry.longtitude ?? null;
    return {
        id: `google/${entry.place_id || entry.cid || entry.data_id || entry.link}`,
        name: entry.title,
        category: entry.category || null,
        categories: Array.isArray(entry.categories) && entry.categories.length ? entry.categories : null,
        address: entry.address || null,
        street: addr.street || null,
        city: addr.city || null,
        state: addr.state || null,
        postcode: addr.postal_code || null,
        country: addr.country || null,
        latitude: entry.latitude || null,
        longitude: longitude || null,
        phone: phones[0] ?? null,
        phones,
        website: cleanWebsite(entry.web_site),
        emails: Array.isArray(entry.emails) ? entry.emails.map((e) => String(e).toLowerCase()) : [],
        socialLinks: {},
        openingHours: formatOpenHours(entry.open_hours),
        rating: entry.review_rating || null,
        reviewCount: entry.review_count ?? null,
        priceRange: entry.price_range || null,
        description: entry.description || null,
        placeId: entry.place_id || null,
        googleMapsUrl: entry.link || null,
        osmUrl: null,
        searchTerm: context.searchTerm,
        location: context.locationName,
        source: 'Google Maps',
    };
}

function searchRadiusMeters(bbox) {
    if (!bbox) return null;
    const [south, west, north, east] = bbox;
    const latMeters = (north - south) * 111_000;
    const lonMeters = (east - west) * 111_000 * Math.cos(((north + south) / 2) * (Math.PI / 180));
    const halfDiagonal = Math.sqrt(latMeters ** 2 + lonMeters ** 2) / 2;
    return Math.round(Math.min(Math.max(halfDiagonal, 5_000), 100_000));
}

/**
 * Runs one Google Maps search and returns the places in Google's own order.
 * Returns an empty list when Google blocks the request or nothing is found.
 */
export async function findGoogleBusinesses({ searchTerm, location, place, locationName, maxResults, language, proxyUrl, budgetMs }) {
    const workDir = await mkdtemp(path.join(tmpdir(), 'gmaps-'));
    const inputFile = path.join(workDir, 'queries.txt');
    const resultsFile = path.join(workDir, 'results.json');
    try {
        await writeFile(inputFile, `${searchTerm} in ${location}\n`);

        const memoryMb = Number(process.env.ACTOR_MEMORY_MBYTES) || 2048;
        const concurrency = Math.min(Math.max(Math.floor(memoryMb / 700), 1), 8);
        const depth = Math.min(Math.max(Math.ceil(maxResults / 15), 1), 15);
        const args = [
            '-input', inputFile,
            '-results', resultsFile,
            '-json',
            '-depth', String(depth),
            '-c', String(concurrency),
            '-lang', language,
            '-exit-on-inactivity', '45s',
        ];
        if (place?.center) {
            args.push('-geo', `${place.center.lat},${place.center.lon}`, '-zoom', '12');
            const radius = searchRadiusMeters(place.bbox);
            if (radius) args.push('-radius', String(radius));
        }
        if (proxyUrl) {
            const proxiesFile = path.join(workDir, 'proxies.txt');
            await writeFile(proxiesFile, `${proxyUrl}\n`);
            args.push('-proxies-file', proxiesFile);
        }

        log.info(`Searching Google Maps for "${searchTerm} in ${location}"`, { depth, concurrency, budgetSecs: Math.round(budgetMs / 1000) });
        const { code, lastLines } = await runEngine(args, budgetMs);

        const text = await readFile(resultsFile, 'utf8').catch(() => '');
        const entries = parseResults(text);
        if (!entries.length) {
            log.warning(`Google Maps returned nothing (exit code ${code}).`, { lastLines });
            return [];
        }

        const seen = new Set();
        const businesses = [];
        for (const entry of entries) {
            if (!entry?.title) continue;
            const business = toBusiness(entry, { searchTerm, locationName });
            if (seen.has(business.id)) continue;
            seen.add(business.id);
            businesses.push(business);
            if (businesses.length >= maxResults) break;
        }
        return businesses;
    } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}
