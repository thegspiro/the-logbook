# Public Website

_Added 2026-11-26 (#4732)._ A website your department publishes for its
community, drawn and served by your own installation of The Logbook. The full
reference, including the server steps, is
[`docs/PUBLIC_WEBSITE.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/PUBLIC_WEBSITE.md).

It is not the **Public Portal**. The portal is a keyed data feed for a website
the department hosts somewhere else; the Public Website is a website The
Logbook serves itself. Both live under **Administration → Organization
Settings**, and both need the **Public Information** module.

## What is on it

The first version has three pages: **Home**, **About** and **Contact**.
Events, recruitment, news, History, minutes and donations are planned as
separate changes and are not on it yet. There are no custom pages, formatted
text or hero photographs: the owner chose fixed sections with switches.

## Setting it up (officers)

Open **Administration → Organization Settings → Public Website**
(`/admin/public-website`). It needs **settings.manage**.

| Section                          | Setting                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Status                           | **Publish the website**: the master switch. Off, every page answers "Not found"                   |
| **Look**                         | **Classic**, **Modern** or **Heritage**. They differ in colour and type, not layout               |
| **Every page and the home page** | **Emergency notice**, **Tagline**, **Welcome text**                                               |
| **About page**                   | **Show the About page** and its text                                                              |
| **Contact page**                 | **Show the Contact page**, and a switch each for **Phone number**, **Email address**, **Address** |
| **Member sign-in link**          | A footer link to the members' address. Off by default                                             |

Everything starts off. Publishing asks **Publish the website?**; switching it
off asks **Take the website down?**. Text is kept either way, and each save is
audited (which fields changed, not the text).

- **Contact details come from the department's record** under Organization
  Settings, not from this page. Each switch shows what the record holds.
- **Text is plain.** A blank line starts a new paragraph.
- **One department only.** On an installation holding more than one
  department, the website is not served and the page says so.
- **No preview in the app.** Check the pages at the public address.

## Serving it (operators)

The website is served on a port of its own, never at the members' address:

| Deployment                                  | Setting            | Default host port | Container port |
| ------------------------------------------- | ------------------ | ----------------- | -------------- |
| Docker Compose                              | `PUBLIC_SITE_PORT` | 3002              | 8080           |
| Unraid (compose or template)                | `PUBLIC_SITE_PORT` | 7882              | 8080           |
| Host install (`setup-ssl.sh --traditional`) | none               | 127.0.0.1:3002    | n/a            |

Point the public hostname (for example `www.yourdepartment.org`) at that port
from whatever already fronts the installation: Nginx Proxy Manager, SWAG,
Traefik, Caddy, a Cloudflare Tunnel or a load balancer. A host-installed nginx
or the Compose `production` profile uses
`infrastructure/nginx/public-site.conf.example`, added by hand; `setup-ssl.sh`
does not request a certificate for the second hostname.

The listener accepts only `GET` and `HEAD` and reaches nothing but the
website: not the API, not the members' application, and no shared cookie. Its
pages run no script and send a Content-Security-Policy with no script source.
Until the website is published every path answers a bare 404. If the
department does not want a public website, leave the port unpublished or
firewalled.

**Upgrading:** the port is published by default. If 3002 (7882 on Unraid) is
already taken on the host, set `PUBLIC_SITE_PORT` before upgrading; see
[`docs/UPGRADING.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/UPGRADING.md#the-web-container-publishes-a-second-port-for-the-public-website-2026-11-26).

## Related

- [Environment variables](Configuration-Environment#port-configuration)
- [History](Module-History) — the "Today in history" widget, which a
  department can embed in a website it hosts elsewhere
