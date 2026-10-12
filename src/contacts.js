const EMAIL_REGEX = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
const JUNK_EMAIL_ENDINGS = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ico|mp4|pdf)$/i;
const JUNK_EMAIL_DOMAINS = /(sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|example\.(com|org)|domain\.com|email\.com|yourdomain|yoursite\.|mysite\.|sentry\.|godaddy\.com|schema\.org|w3\.org)$/i;
const JUNK_EMAIL_USERS = /^(your|you|name|user|username|email|example|test|firstname|john\.doe)$/i;

const SOCIAL_PATTERNS = {
    facebook: /^https?:\/\/(?:[a-z-]+\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|policies|privacy|help)[^\s?#]+/i,
    instagram: /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore|accounts|reel\/)[^\s?#/]+/i,
    twitter: /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search|hashtag)[^\s?#/]+/i,
    linkedin: /^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(?:company|in|school)\/[^\s?#/]+/i,
    youtube: /^https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)[^\s?#/]+/i,
    tiktok: /^https?:\/\/(?:www\.)?tiktok\.com\/@[^\s?#/]+/i,
    pinterest: /^https?:\/\/(?:[a-z]+\.)?pinterest\.[a-z.]+\/(?!pin\/)[^\s?#/]+/i,
    whatsapp: /^https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^\s#]+/i,
};

const CONTACT_LINK_REGEX = /contact|kontakt|contacto|contatt|about|impressum|imprint|get-in-touch|reach-us|team/i;

function decodeCloudflareEmail(hex) {
    try {
        const key = parseInt(hex.slice(0, 2), 16);
        let out = '';
        for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
        return out;
    } catch {
        return null;
    }
}

function isUsefulEmail(email) {
    if (email.length > 80) return false;
    const [user, domain] = email.split('@');
    if (!user || !domain) return false;
    if (JUNK_EMAIL_ENDINGS.test(email) || JUNK_EMAIL_DOMAINS.test(domain) || JUNK_EMAIL_USERS.test(user)) return false;
    // Hashes used by error trackers look like 32 hex chars before the @
    if (/^[a-f0-9]{24,}$/i.test(user)) return false;
    return true;
}

/**
 * Collects emails, phone numbers and social links from a parsed page.
 */
export function extractContacts($) {
    const emails = new Set();
    const phones = new Set();
    const socialLinks = {};

    const addEmail = (raw) => {
        const email = decodeURIComponent(String(raw)).trim().toLowerCase().replace(/^[.\-_]+|[.\-_]+$/g, '');
        if (isUsefulEmail(email)) emails.add(email);
    };

    $('a[href]').each((_, el) => {
        const href = ($(el).attr('href') ?? '').trim();
        if (/^mailto:/i.test(href)) {
            const address = href.replace(/^mailto:/i, '').split('?')[0];
            for (const part of address.split(/[,;]/)) {
                try {
                    addEmail(part);
                } catch {
                    // malformed percent-encoding, skip
                }
            }
        } else if (/^tel:/i.test(href)) {
            const phone = href.replace(/^tel:/i, '').replace(/%20/g, ' ').trim();
            if (phone.replace(/\D/g, '').length >= 7) phones.add(phone);
        } else {
            for (const [network, pattern] of Object.entries(SOCIAL_PATTERNS)) {
                if (socialLinks[network]) continue;
                const match = href.match(pattern);
                if (match) socialLinks[network] = match[0].replace(/\/$/, '');
            }
        }
    });

    $('[data-cfemail]').each((_, el) => {
        const decoded = decodeCloudflareEmail($(el).attr('data-cfemail') ?? '');
        if (decoded) addEmail(decoded);
    });

    const scriptsWithData = $('script[type="application/ld+json"]')
        .map((_, el) => $(el).html())
        .get()
        .join(' ');
    // Tags become spaces so that text of neighbouring elements does not glue onto an address.
    const visibleText = ($('body').clone().find('script, style, noscript, svg').remove().end().html() ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ');
    for (const match of `${visibleText} ${scriptsWithData}`.match(EMAIL_REGEX) ?? []) addEmail(match);

    return { emails: [...emails], phones: [...phones], socialLinks };
}

/**
 * Finds same-site links that look like contact or about pages.
 */
export function findContactLinks($, baseUrl, limit) {
    if (limit <= 0) return [];
    let base;
    try {
        base = new URL(baseUrl);
    } catch {
        return [];
    }
    const found = new Map();
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const text = $(el).text();
        if (!CONTACT_LINK_REGEX.test(href) && !CONTACT_LINK_REGEX.test(text)) return;
        try {
            const url = new URL(href, base);
            if (!/^https?:$/.test(url.protocol)) return;
            if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) return;
            url.hash = '';
            if (url.href === base.href) return;
            // Real contact pages first, about / team pages after.
            const priority = /contact|kontakt|contacto|contatt|impressum|imprint/i.test(`${href} ${text}`) ? 0 : 1;
            if (!found.has(url.href)) found.set(url.href, priority);
        } catch {
            // not a valid URL
        }
    });
    return [...found.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, limit)
        .map(([url]) => url);
}

export function mergeContacts(target, extra) {
    for (const email of extra.emails) if (!target.emails.includes(email)) target.emails.push(email);
    for (const phone of extra.phones) {
        const digits = phone.replace(/\D/g, '');
        if (!target.phones.some((p) => p.replace(/\D/g, '').endsWith(digits.slice(-9)))) target.phones.push(phone);
    }
    for (const [network, url] of Object.entries(extra.socialLinks)) {
        if (!target.socialLinks[network]) target.socialLinks[network] = url;
    }
}
