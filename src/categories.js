// Maps everyday business words to OpenStreetMap tags.
// Each entry: [synonyms (singular, lowercase), [[key, value], ...]]
const CATEGORIES = [
    [['clothing', 'clothes', 'apparel', 'fashion', 'boutique'], [['shop', 'clothes'], ['shop', 'boutique']]],
    [['shoe', 'footwear'], [['shop', 'shoes']]],
    [['jewelry', 'jewellery', 'jeweler', 'jeweller'], [['shop', 'jewelry']]],
    [['supermarket', 'grocery'], [['shop', 'supermarket'], ['shop', 'greengrocer'], ['shop', 'convenience']]],
    [['convenience'], [['shop', 'convenience']]],
    [['bakery'], [['shop', 'bakery']]],
    [['butcher'], [['shop', 'butcher']]],
    [['florist', 'flower'], [['shop', 'florist']]],
    [['bookstore', 'bookshop', 'book'], [['shop', 'books']]],
    [['electronics'], [['shop', 'electronics']]],
    [['mobile phone', 'cell phone', 'phone shop', 'phone store'], [['shop', 'mobile_phone']]],
    [['computer'], [['shop', 'computer']]],
    [['furniture'], [['shop', 'furniture']]],
    [['hardware', 'diy'], [['shop', 'hardware'], ['shop', 'doityourself']]],
    [['pet'], [['shop', 'pet']]],
    [['toy'], [['shop', 'toys']]],
    [['sport', 'sporting good'], [['shop', 'sports']]],
    [['bicycle', 'bike'], [['shop', 'bicycle']]],
    [['car dealer', 'car dealership', 'auto dealer'], [['shop', 'car']]],
    [['car repair', 'auto repair', 'mechanic', 'garage'], [['shop', 'car_repair']]],
    [['car wash'], [['amenity', 'car_wash']]],
    [['car rental'], [['amenity', 'car_rental']]],
    [['optician', 'optical', 'eyewear'], [['shop', 'optician']]],
    [['cosmetic', 'beauty supply', 'makeup'], [['shop', 'cosmetics']]],
    [['beauty salon', 'beauty', 'nail salon', 'spa'], [['shop', 'beauty']]],
    [['hair salon', 'hairdresser', 'barber', 'salon'], [['shop', 'hairdresser']]],
    [['tattoo'], [['shop', 'tattoo']]],
    [['laundry', 'dry cleaner', 'dry cleaning'], [['shop', 'laundry'], ['shop', 'dry_cleaning']]],
    [['liquor', 'wine'], [['shop', 'alcohol'], ['shop', 'wine']]],
    [['gift', 'souvenir'], [['shop', 'gift']]],
    [['mall', 'shopping centre', 'shopping center'], [['shop', 'mall']]],
    [['department store'], [['shop', 'department_store']]],
    [['travel agency', 'travel agent'], [['shop', 'travel_agency']]],
    [['restaurant', 'eatery', 'diner'], [['amenity', 'restaurant']]],
    [['fast food', 'takeaway', 'burger', 'pizza'], [['amenity', 'fast_food']]],
    [['cafe', 'coffee'], [['amenity', 'cafe']]],
    [['bar'], [['amenity', 'bar']]],
    [['pub'], [['amenity', 'pub']]],
    [['nightclub', 'club'], [['amenity', 'nightclub']]],
    [['ice cream'], [['amenity', 'ice_cream']]],
    [['hotel'], [['tourism', 'hotel']]],
    [['motel'], [['tourism', 'motel']]],
    [['hostel'], [['tourism', 'hostel']]],
    [['guest house', 'bed and breakfast', 'b&b'], [['tourism', 'guest_house']]],
    [['museum'], [['tourism', 'museum']]],
    [['art gallery', 'gallery'], [['tourism', 'gallery'], ['shop', 'art']]],
    [['dentist', 'dental'], [['amenity', 'dentist'], ['healthcare', 'dentist']]],
    [['doctor', 'physician', 'medical clinic', 'clinic'], [['amenity', 'doctors'], ['amenity', 'clinic']]],
    [['hospital'], [['amenity', 'hospital']]],
    [['pharmacy', 'drugstore', 'chemist'], [['amenity', 'pharmacy']]],
    [['veterinary', 'veterinarian', 'vet'], [['amenity', 'veterinary']]],
    [['physiotherapist', 'physiotherapy', 'physical therapy'], [['healthcare', 'physiotherapist']]],
    [['gym', 'fitness'], [['leisure', 'fitness_centre']]],
    [['yoga'], [['leisure', 'fitness_centre'], ['sport', 'yoga']]],
    [['bank'], [['amenity', 'bank']]],
    [['school'], [['amenity', 'school']]],
    [['kindergarten', 'preschool', 'daycare'], [['amenity', 'kindergarten'], ['amenity', 'childcare']]],
    [['driving school'], [['amenity', 'driving_school']]],
    [['cinema', 'movie theater', 'movie theatre'], [['amenity', 'cinema']]],
    [['coworking'], [['amenity', 'coworking_space'], ['office', 'coworking']]],
    [['marketing', 'advertising', 'digital marketing', 'seo'], [['office', 'advertising_agency'], ['office', 'marketing']]],
    [['lawyer', 'attorney', 'law firm', 'solicitor'], [['office', 'lawyer']]],
    [['accountant', 'accounting', 'bookkeeper'], [['office', 'accountant'], ['office', 'tax_advisor']]],
    [['real estate', 'estate agent', 'realtor', 'property'], [['office', 'estate_agent']]],
    [['insurance'], [['office', 'insurance']]],
    [['architect'], [['office', 'architect']]],
    [['it company', 'software', 'web design', 'web development'], [['office', 'it']]],
    [['consultant', 'consulting'], [['office', 'consulting']]],
    [['recruitment', 'employment agency', 'staffing'], [['office', 'employment_agency']]],
    [['financial advisor', 'financial'], [['office', 'financial'], ['office', 'financial_advisor']]],
    [['plumber', 'plumbing'], [['craft', 'plumber']]],
    [['electrician'], [['craft', 'electrician']]],
    [['carpenter'], [['craft', 'carpenter']]],
    [['painter'], [['craft', 'painter']]],
    [['roofer', 'roofing'], [['craft', 'roofer']]],
    [['photographer', 'photography', 'photo studio'], [['craft', 'photographer'], ['shop', 'photo']]],
    [['tailor'], [['craft', 'tailor'], ['shop', 'tailor']]],
    [['brewery'], [['craft', 'brewery']]],
];

export const BUSINESS_KEYS = ['shop', 'amenity', 'office', 'craft', 'tourism', 'leisure', 'healthcare'];

// Words that describe "a business" in general and say nothing about its type.
const GENERIC_WORDS = new Set([
    'shop', 'store', 'company', 'business', 'agency', 'service', 'firm', 'office', 'studio',
    'centre', 'center', 'place', 'the', 'best', 'top', 'local', 'near', 'me', 'and', 'of',
]);

function singular(word) {
    if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
    if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

export function normalizeTerm(term) {
    return String(term)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}&\s-]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(singular)
        .join(' ');
}

function containsPhrase(haystack, phrase) {
    return ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * Turns a free-text business type into OSM tag filters and a keyword for name matching.
 */
export function resolveCategory(term) {
    const normalized = normalizeTerm(term);
    const tags = [];
    const seen = new Set();
    for (const [synonyms, entryTags] of CATEGORIES) {
        if (!synonyms.some((s) => containsPhrase(normalized, s))) continue;
        for (const [key, value] of entryTags) {
            const id = `${key}=${value}`;
            if (!seen.has(id)) {
                seen.add(id);
                tags.push([key, value]);
            }
        }
    }

    const specific = normalized.split(' ').filter((w) => !GENERIC_WORDS.has(w));
    const keyword = (specific.length ? specific : normalized.split(' ')).join(' ').trim();

    return { normalized, tags, keyword };
}
