# Local Business Finder

Find local businesses by **type and city** and get their contact details in one table.

Type what you are looking for, for example `clothing shops` in `Los Angeles` or `dentists` in `Chicago`. The actor searches **Google Maps** and returns each business with address, phone, website, rating, review count and opening hours. It then visits each business website and adds the **emails, phone numbers and social media links** found there.

When Google Maps returns nothing or blocks the request, the actor switches to **OpenStreetMap** automatically, so a run still ends with data.

## What you get

One row per business:

| Field | Example |
|---|---|
| `name` | Burning Torch |
| `category`, `categories` | Clothing store |
| `address`, `street`, `city`, `state`, `postcode`, `country` | 1227 Abbot Kinney Blvd, Venice, CA 90291 |
| `latitude`, `longitude` | 33.9914634, -118.468582 |
| `phone`, `phones` | +1 310-399-1920 |
| `website` | https://www.burningtorchinc.com/ |
| `emails` | hello@burningtorchinc.com |
| `socialLinks` | instagram, facebook, twitter, linkedin, youtube, tiktok, pinterest, whatsapp |
| `rating`, `reviewCount`, `priceRange` | 4.6, 58 (Google Maps rows only) |
| `openingHours` | Monday: 11 AM–7 PM; Tuesday: 11 AM–7 PM … |
| `source` | `Google Maps` or `OpenStreetMap` |
| `websiteStatus` | `ok`, `failed`, `none` (no website listed) or `not_checked` |
| `websiteTitle`, `websiteDescription` | Title and meta description of the home page |
| `googleMapsUrl`, `placeId`, `osmUrl` | Links and ids of the listing |
| `searchTerm`, `location` | The search this row belongs to |

## Input

| Field | Description |
|---|---|
| **Business types** | One or more terms: `clothing shops`, `restaurants`, `marketing agencies`, `plumbers` … |
| **Locations** | One or more cities, districts or regions. Every type is searched in every location. |
| **Max results per search** | Limit per type and location pair. |
| **Data source** | Automatic (Google Maps, then OpenStreetMap), Google Maps only, or OpenStreetMap only. |
| **Language** | Language code for Google Maps results. |
| **Collect contacts from websites** | Turn off for a faster run with listing data only. |
| **Pages per website** | Home page plus contact / about pages to check (1 to 5). |
| **Only businesses with a website** | Skip listings that have no website. |
| **Proxy** | Optional. Residential proxies give the best results on Google Maps. |

You can also write a full phrase such as `dentists in Chicago` as the business type and leave Locations empty.

```json
{
    "searchTerms": ["clothing shops", "shoe stores"],
    "locations": ["Los Angeles", "San Diego"],
    "maxResultsPerSearch": 100
}
```

## How it works

1. The location is geocoded to its centre and boundaries.
2. Google Maps is searched with a real browser and each listing is opened for its details.
3. If Google Maps gives no results, the same search runs on OpenStreetMap.
4. Each business website is opened and its home, contact and about pages are scanned for emails, phone numbers and social links.

The run always finishes with a dataset. A business whose website cannot be reached is still returned with its listing data and `websiteStatus: failed`. If a search matches nothing on either source, the dataset contains one row with `status: no_results` and a hint on what to change.

## Good to know

- Google Maps limits automated traffic. Without a proxy, large or repeated runs may get fewer Google results; those searches are then answered from OpenStreetMap. The `source` field shows where each row came from.
- OpenStreetMap rows have no rating or review count. Shops, restaurants, hotels and health services are covered well there; office-based businesses such as agencies are covered less completely.
- Not every listing has a phone number or a website.
- Phone numbers and emails of small businesses can be personal data. Follow the rules that apply to you (GDPR, CCPA, CAN-SPAM) when you use them.

## Credits and licences

- Google Maps search uses the open-source [google-maps-scraper](https://github.com/gosom/google-maps-scraper) engine by Georgios Komninos, MIT License, Copyright (c) 2023 Georgios Komninos.
- OpenStreetMap listings © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License (ODbL). If you publish that data, credit OpenStreetMap.
