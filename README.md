# Local Business Finder

Find local businesses by **type and city** and get their contact details in one table.

Type what you are looking for, for example `clothing shops` in `Los Angeles` or `dentists` in `Chicago`, and the actor returns the businesses it finds with address, phone, website and opening hours. It then visits each business website and adds the **emails, phone numbers and social media links** found there.

## What you get

One row per business:

| Field | Example |
|---|---|
| `name` | Burning Torch |
| `category` | clothes |
| `address`, `street`, `city`, `state`, `postcode`, `country` | 1227 Abbot Kinney Boulevard, Los Angeles, California 90291, US |
| `latitude`, `longitude` | 33.9914634, -118.468582 |
| `phone`, `phones` | +1 310 399 1920 |
| `website` | https://www.burningtorchinc.com/ |
| `emails` | hello@burningtorchinc.com |
| `socialLinks` | instagram, facebook, twitter, linkedin, youtube, tiktok, pinterest, whatsapp |
| `openingHours` | Mo-Sa 11:00-19:00; Su 11:00-17:00 |
| `websiteStatus` | `ok`, `failed`, `none` (no website listed) or `not_checked` |
| `websiteTitle`, `websiteDescription` | Title and meta description of the home page |
| `googleMapsUrl`, `osmUrl` | Links to open the place on a map |
| `searchTerm`, `location` | The search this row belongs to |

## Input

| Field | Description |
|---|---|
| **Business types** | One or more terms: `clothing shops`, `restaurants`, `marketing agencies`, `plumbers` … |
| **Locations** | One or more cities, districts or regions. Every type is searched in every location. |
| **Max results per search** | Limit per type and location pair. The most complete listings come first. |
| **Collect contacts from websites** | Turn off for a faster run with listing data only. |
| **Pages per website** | Home page plus contact / about pages to check (1 to 5). |
| **Only businesses with a website** | Skip listings that have no website. |
| **Proxy for website visits** | Optional. |

You can also write a full phrase such as `dentists in Chicago` as the business type and leave Locations empty.

```json
{
    "searchTerms": ["clothing shops", "shoe stores"],
    "locations": ["Los Angeles", "San Diego"],
    "maxResultsPerSearch": 100
}
```

## How it works

1. The location is geocoded to its boundaries.
2. Businesses of the requested type are read from OpenStreetMap. If the main query service is busy, a second search service is used automatically.
3. Each business website is opened and its home, contact and about pages are scanned for emails, phone numbers and social links.

The run always finishes with a dataset. A business whose website cannot be reached is still returned with its listing data and `websiteStatus: failed`. If a search matches nothing, the dataset contains one row with `status: no_results` and a hint on what to change.

## Good to know

- Data comes from OpenStreetMap, which is maintained by volunteers. Shops, restaurants, hotels and health services are covered well in most cities. Office-based businesses such as agencies and consultancies are covered less completely.
- Ratings and reviews are not part of OpenStreetMap and are not returned.
- Not every listing has a phone number or a website.
- When the fallback search service is used, results come from a rectangle around the location and can include places just outside the city limits.

## Data source and licence

Business listings © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License (ODbL). If you publish the data, credit OpenStreetMap.
