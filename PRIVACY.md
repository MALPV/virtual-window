# Privacy

Virtual Window shows the real sky and weather where you are. This page explains exactly what leaves your computer to make that possible.

## What is sent, and to whom

| When                                  | Sent to                                   | What                                              | Why                         |
|---------------------------------------|-------------------------------------------|---------------------------------------------------|-----------------------------|
| At startup, at most every 12 hours    | [ipapi.co](https://ipapi.co/privacy/), or [ipwho.is](https://ipwho.is/) if the first fails | Your IP address (inherent to any request)        | Approximate location        |
| Every 15 minutes while running        | [Open-Meteo](https://open-meteo.com/en/terms) | Approximate coordinates (rounded to about 1 km) and your IP address | Current weather |

All requests use HTTPS and are made by the app's native backend. The web view that draws the scenes has no network access.

## What is stored on your computer

- `location.json` in the app's cache directory: rounded latitude and longitude plus the time they were obtained. It is reused for 12 hours so the app starts instantly and makes fewer requests.
- Your selected scene, in the web view's local storage.

The city name and your IP address are never stored.

## What is not collected

No accounts, no analytics, no telemetry, no crash reporting. Scenes, including community scenes, never receive your location: only derived values such as the sun's height and the weather.

## Using it without location

There is currently no setting to turn the location lookup off. If you block the app's network access (for example with a firewall), it keeps working: the day and night cycle is approximated from your system time zone, without weather.

## Accuracy

IP geolocation is approximate. Behind a VPN, the sky and weather will be those of the VPN server.
