# Rotation Lab · speaker notes

Seven slides for NASA Space Apps 2026, Field Shift. Slides: `rotation-lab-slides.pdf` (or `rotation-lab-slides.html`).

## 1. cover

One sentence: Rotation Lab brings 45 years of NASA weather and every NASA satellite image of a grower’s own field together, as evidence for what to plant, when, and in what order. The grower stays the decision-maker.

## 2. motivation

The challenge in three parts. Rotation: what a grower plants this year affects soil, pests and yields for years. Climate shift: the timing of frosts, dry spells and heat that farms were planned around is moving. Data: NASA holds decades of weather and satellite records, but they are scattered and hard to apply to one field’s decision. Rotation Lab answers one question for one field: which crops will grow reliably, when to plant them, and in what order.

## 3. resources

All the analysis runs on open NASA data. NASA POWER gives daily weather and soil wetness for the field’s location back to 1981, plus long-term monthly normals. NASA HLS, which harmonises Landsat and Sentinel-2 at 30 metres, gives the field’s own record since 2020: every image, clouds removed. NASA GIBS supplies map layers for context. Calculations follow FAO-56; ESA WorldCover marks the farmland around the field; the grower adds what NASA can’t know.

## 4. space

This is the field view for a rainfed demo field near Orosháza, Hungary. The green line is this season’s greenness from NASA HLS; the shaded band is the field’s usual range for an autumn-sown crop, from its earlier seasons of the same crop. In May and June 2026 the crop fell well below it. The season check flagged 2026 as 23 percent less green before any weather was attached, and the NASA POWER record then showed the lowest rainfall and most hot days in 11 seasons. It also caught 2022, during the longest dry spell on record. The wording is “may have played a part”, never “caused”.

## 5. thennow

From the full NASA POWER record since 1981, the app compares the 1990s with the last ten seasons. In Stjørdal the frost-free season is 18 days longer and the last spring frost 12 days earlier, so more crops ripen; but for potatoes, warm humid blight weather has risen from about 7 to 12 days a season. In Orosháza, days above 30 degrees rose from about 40 to 62. A change is listed only if the whole 45-year record trends consistently, and the app does not call changes good or bad: a longer season helps some crops, more heat hurts others.

## 6. trust

Why trust it. We checked the satellite crop types around the Stjørdal field against Statistics Norway: that check exposed a real flaw with northern grass leys, which we fixed, and grass and cereals now come within a few points. The app says when it cannot judge, and why. It gives evidence and options, never orders: likely crops are hints, and the rotation it checks is the grower’s own. It is free and needs no account. On a laptop it works for any temperate field, even offline; the hosted site shows the two demo fields, because reading a new field's satellite record takes longer than a hosted request may run. Limits are stated too: crop profiles still need an agronomist’s review.

## 7. close

Close with the promise and the two links: the live app, with two demo fields in Norway and Hungary, and the open code. Invite questions, and offer to show any field the audience names on a laptop.
