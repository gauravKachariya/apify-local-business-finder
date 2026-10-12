import { setTimeout as sleep } from 'node:timers/promises';

import { CheerioCrawler, log } from '@crawlee/cheerio';
import { Actor } from 'apify';
import * as cheerio from 'cheerio';

import { extractContacts, findContactLinks, mergeContacts } from './contacts.js';
import { findGoogleBusinesses, isEngineAvailable } from './google.js';
import { findBusinesses, geocode } from './osm.js';

const DEFAULT_SEARCH_TERMS = ['clothing shops'];
const DEFAULT_LOCATIONS = ['Los Angeles'];

// A single bad page or API hiccup must never take the whole run down.
process.on('unhandledRejection', (reason) => log.warning(`Unhandled rejection: ${reason?.message ?? reason}`));
process.on('uncaughtException', (err) => log.warning(`Uncaught exception: ${err?.message ?? err}`));

function toList(value) {
    if (value == null) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map((v) => String(v?.url ?? v ?? '').trim()).filter(Boolean);
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

function msUntilTimeout() {
    const timeoutAt = Date.parse(process.env.ACTOR_TIMEOUT_AT ?? '');
    return Number.isFinite(timeoutAt) ? timeoutAt - Date.now() : Infinity;
}

function buildSearches(input) {
    let terms = toList(input.searchTerms ?? input.searchTerm);
    let locations = toList(input.locations ?? input.location);
    if (!terms.length && !locations.length) {
        log.warning('No input given, running the example search.');
        terms = DEFAULT_SEARCH_TERMS;
        locations = DEFAULT_LOCATIONS;
    }
    if (!terms.length) terms = DEFAULT_SEARCH_TERMS;

    const searches = [];
    const problems = [];
    for (const term of terms) {
        if (locations.length) {
            for (const location of locations) searches.push({ searchTerm: term, location });
            continue;
        }
        const match = term.match(/^(.+?)\s+(?:in|near)\s+(.+)$/i);
        if (match) searches.push({ searchTerm: match[1].trim(), location: match[2].trim() });
        else problems.push({ searchTerm: term, location: null, error: 'No location given. Add a city to "Locations" or write the term as "dentists in Chicago".' });
    }
    return { searches, problems };
}

await Actor.init();

const state = await Actor.useState('STATE', { pushed: {}, rows: 0 });
const pending = new Map();
const summary = { searches: [], businessesFound: 0, websitesChecked: 0, websitesFailed: 0 };

async function pushRow(row) {
    try {
        await Actor.pushData(row);
        state.rows++;
    } catch (err) {
        log.warning(`Could not store a row: ${err.message}`);
    }
}

async function pushBusiness(business, website, contacts) {
    if (!business || state.pushed[business.id]) return;
    state.pushed[business.id] = true;
    pending.delete(business.id);

    const { id, ...rest } = business;
    const row = { ...rest, emails: [...business.emails], phones: [...business.phones], socialLinks: { ...business.socialLinks } };
    if (contacts) mergeContacts(row, contacts);
    row.phone = row.phones[0] ?? null;
    await pushRow({ ...row, ...website, sourceId: id, status: 'ok', scrapedAt: new Date().toISOString() });
}

async function run() {
    const input = (await Actor.getInput()) ?? {};
    const maxResults = clampInt(input.maxResultsPerSearch, 50, 1, 2000);
    const maxPagesPerWebsite = clampInt(input.maxPagesPerWebsite, 3, 1, 5);
    const maxConcurrency = clampInt(input.maxConcurrency, 10, 1, 50);
    const enrichWebsites = input.enrichWebsites !== false;
    const onlyWithWebsite = input.onlyWithWebsite === true;
    const dataSource = ['auto', 'google', 'openstreetmap'].includes(input.dataSource) ? input.dataSource : 'auto';
    const language = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(input.language ?? '') ? input.language : 'en';

    const { searches, problems } = buildSearches(input);
    for (const problem of problems) {
        log.warning(`Skipping "${problem.searchTerm}": ${problem.error}`);
        summary.searches.push({ ...problem, found: 0 });
    }

    let proxyConfiguration;
    if (input.proxyConfiguration) {
        try {
            proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
        } catch (err) {
            log.warning(`Proxy could not be set up, continuing without it: ${err.message}`);
        }
    }

    let useGoogle = dataSource !== 'openstreetmap';
    if (useGoogle && !(await isEngineAvailable())) {
        log.warning('Google Maps engine is not available in this environment, using OpenStreetMap only.');
        useGoogle = false;
    }

    // 1. Find the businesses.
    const places = new Map();
    for (const { searchTerm, location } of searches) {
        const entry = { searchTerm, location, source: null, found: 0, error: null };
        summary.searches.push(entry);
        try {
            if (!places.has(location)) {
                if (places.size) await sleep(1100); // geocoder allows one request per second
                places.set(location, await geocode(location));
            }
            const place = places.get(location);
            const locationName = place?.displayName || location;

            let businesses = [];
            if (useGoogle) {
                // Leave room for the fallback search and the website visits before the run times out.
                const budgetMs = Math.min(45_000 + maxResults * 2000, 600_000, msUntilTimeout() - 120_000);
                if (budgetMs < 30_000) {
                    log.warning('Not enough run time left for a Google Maps search.');
                } else {
                    try {
                        businesses = await findGoogleBusinesses({
                            searchTerm,
                            location,
                            place,
                            locationName,
                            maxResults,
                            language,
                            proxyUrl: await proxyConfiguration?.newUrl(),
                            budgetMs,
                        });
                        if (businesses.length) entry.source = 'Google Maps';
                    } catch (err) {
                        log.warning(`Google Maps search failed: ${err.message}`);
                    }
                }
            }

            if (!businesses.length && dataSource !== 'google') {
                if (!place) {
                    entry.error = `Location "${location}" was not found`;
                    log.warning(entry.error);
                    continue;
                }
                if (useGoogle) log.info('Falling back to OpenStreetMap.');
                businesses = await findBusinesses({ searchTerm, place, locationName, maxResults });
                if (businesses.length) entry.source = 'OpenStreetMap';
            }

            for (const business of businesses) {
                if (onlyWithWebsite && !business.website) continue;
                if (state.pushed[business.id] || pending.has(business.id)) continue;
                pending.set(business.id, business);
                entry.found++;
            }
            log.info(`Found ${entry.found} businesses for "${searchTerm}" in ${location}`);
        } catch (err) {
            entry.error = err.message;
            log.warning(`Search "${searchTerm}" in ${location} failed: ${err.message}`);
        }
    }
    summary.businessesFound = pending.size;

    // 2. Businesses without a website need no further work; they are stored after the enriched ones.
    const toVisit = enrichWebsites ? [...pending.values()].filter((business) => business.website) : [];
    if (!toVisit.length) return;

    // 3. Visit the websites for emails, phones and social links.
    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxConcurrency,
        maxRequestRetries: 1,
        navigationTimeoutSecs: 25,
        requestHandlerTimeoutSecs: 70,
        async requestHandler({ request, $, sendRequest }) {
            const business = pending.get(request.userData.businessId);
            if (!business) return;
            const pageUrl = request.loadedUrl ?? request.url;
            const contacts = extractContacts($);
            let pagesChecked = 1;

            for (const link of findContactLinks($, pageUrl, maxPagesPerWebsite - 1)) {
                try {
                    const response = await sendRequest({ url: link, throwHttpErrors: false, timeout: { request: 15_000 } });
                    const isHtml = /html/i.test(String(response.headers['content-type'] ?? ''));
                    if (response.statusCode < 400 && isHtml && typeof response.body === 'string') {
                        mergeContacts(contacts, extractContacts(cheerio.load(response.body)));
                        pagesChecked++;
                    }
                } catch (err) {
                    log.debug(`Contact page ${link} failed: ${err.message}`);
                }
            }

            summary.websitesChecked++;
            await pushBusiness(
                business,
                {
                    websiteStatus: 'ok',
                    websiteTitle: $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 300) || null,
                    websiteDescription: ($('meta[name="description"]').attr('content') ?? '').trim().slice(0, 500) || null,
                    pagesChecked,
                },
                contacts,
            );
        },
        async failedRequestHandler({ request }, error) {
            summary.websitesFailed++;
            await pushBusiness(pending.get(request.userData.businessId), {
                websiteStatus: 'failed',
                websiteError: String(error?.message ?? error).split('\n')[0].slice(0, 300),
            });
        },
    });

    // Stop a little before the platform timeout so the run ends cleanly with everything stored.
    if (Number.isFinite(msUntilTimeout())) {
        const msLeft = msUntilTimeout() - 45_000;
        setTimeout(() => {
            log.warning('Time limit is close, finishing with what has been collected.');
            crawler.autoscaledPool?.abort().catch(() => {});
        }, Math.max(msLeft, 1000)).unref();
    }

    await crawler.run(
        toVisit.map((business) => ({
            url: business.website,
            uniqueKey: business.id,
            userData: { businessId: business.id },
        })),
    );
}

try {
    await run();
} catch (err) {
    log.error(`Run stopped early: ${err?.message ?? err}`);
    summary.error = String(err?.message ?? err);
}

// Anything found but not stored yet (time limit, crash) still goes to the dataset.
for (const business of [...pending.values()]) {
    await pushBusiness(business, { websiteStatus: business.website ? 'not_checked' : 'none' });
}

if (state.rows === 0) {
    await pushRow({
        status: summary.error ? 'error' : 'no_results',
        message: summary.error
            ?? 'No businesses matched. Try a broader business type (e.g. "restaurants") or a larger location.',
        searches: summary.searches,
        scrapedAt: new Date().toISOString(),
    });
}

summary.rows = state.rows;
try {
    await Actor.setValue('OUTPUT', summary);
} catch (err) {
    log.warning(`Could not store the run summary: ${err.message}`);
}
log.info('Finished', summary);

await Actor.exit();
