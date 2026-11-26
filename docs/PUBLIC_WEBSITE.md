# Public Website

A website a department publishes for its own community, rendered by its
installation of The Logbook. It is separate from two things with similar names:

- The **Public Portal** ([PUBLIC_PORTAL_MODULE.md](./PUBLIC_PORTAL_MODULE.md))
  is a keyed JSON API for a website the department hosts somewhere else.
- **thelogbook.us** is the project's own documentation site and has nothing to
  do with any department.

This first version has the foundation and three pages: Home, About and Contact.
See [What is not built yet](#what-is-not-built-yet).

## How it is served

The pages are plain HTML rendered by the backend
(`backend/app/api/public/site.py`, templates in
`backend/app/templates/public_site/`). They run no script, so search engines
and link previews read the same content a visitor does.

The website is served on **a port of its own**, not at the address members
sign in at:

| Deployment                                  | Setting            | Default host port | Container port |
| ------------------------------------------- | ------------------ | ----------------- | -------------- |
| Docker Compose                              | `PUBLIC_SITE_PORT` | 3002              | 8080           |
| Unraid (compose or image)                   | `PUBLIC_SITE_PORT` | 7882              | 8080           |
| Host install (`setup-ssl.sh --traditional`) | none               | 127.0.0.1:3002    | n/a            |

The web container's nginx has a second listener for it
(`frontend/nginx.conf`). That listener hands every path to the backend's
`/public-site` router and nothing else: the API and the members' application
are not reachable through it, and it accepts only `GET` and `HEAD`. Because
the website has its own address, it shares no origin and no cookie with the
members' application.

Until a department switches its website on, every path on the port answers a
bare `404 Not found` that names nobody.

## Switching it on

**Administration → Public Website** (`/admin/public-website`). It needs the
`settings.manage` permission and the Public Information module.

| Setting             | What it does                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| Publish the website | The master switch. Off, nothing is served.                                |
| Look                | One of three themes: Classic, Modern or Heritage.                         |
| Emergency notice    | A band at the top of every page, for example "In an emergency, call 911." |
| Tagline             | One line under the department's name. Also the page description.          |
| Welcome text        | Paragraphs on the home page.                                              |
| About page          | Its own switch, and its text.                                             |
| Contact page        | Its own switch, and one switch each for phone, email and address.         |
| Member sign-in link | A footer link to the members' address (`FRONTEND_URL`). Off by default.   |

Everything is off until somebody turns it on. Publishing and taking the
website down each ask for confirmation, and each change is written to the
audit log (which fields changed and where the switches stand, not the text).

**Contact details are not typed here.** They are the department's own record
(Organization Settings: phone, email, and the physical address, or the mailing
address when no separate physical one is kept). The settings screen shows what
the record holds beside each switch.

**All text is plain text.** A blank line starts a new paragraph. Nothing a
department types is treated as markup: the templates escape every value.

The department's logo, when one is uploaded, appears in the header.

## Pointing your public address at it

Point the public hostname (for example `www.yourdepartment.org`) at the public
website port, using whatever already sits in front of the installation.

- **Nginx Proxy Manager, SWAG, Traefik, Caddy:** add a proxy host for the
  public hostname that forwards to `http://<server>:<PUBLIC_SITE_PORT>`, with
  its own certificate.
- **Cloudflare Tunnel:** add a public hostname whose service is
  `http://<server>:<PUBLIC_SITE_PORT>`.
- **AWS Application Load Balancer:** add a target group on the public website
  port and a host-header rule that sends the public hostname to it.
- **Host-installed nginx, or the Compose `production` profile:** copy
  `infrastructure/nginx/public-site.conf.example`, set the hostname and
  certificate paths, and load it beside the main site configuration. The file's
  header says what to change for each layout. Under `docker-compose.proxy.yml`
  the web container publishes no ports, so the example's upstream must be
  `frontend:8080`.

The proxy in front should pass `X-Forwarded-For` and `X-Forwarded-Proto`, as
it does for the members' address. Leave the port unpublished, or firewalled,
if the department does not want a public website; with the website switched
off it serves nothing either way.

## Security notes

- Anonymous and read-only. Rate limited per address (240 requests a minute).
- Served only on a deployment with **exactly one** department. A visitor
  carries no department, so with two or more the website answers 404 rather
  than choose one. The settings screen says so when this applies.
- Pages are `Cache-Control: no-store`, so switching the website or a page off
  takes effect at once. The stylesheet and logo are addressed by a digest of
  their content and cached for a long time.
- The listener sends its own Content-Security-Policy:
  `default-src 'none'; style-src 'self'; img-src 'self'`, with no script
  source at all.
- `robots.txt` allows crawling while the website is on and disallows it while
  it is off.

## What is not built yet

Decided with the owner on 2026-11-26 and planned as separate changes:

- **Events and Join us:** upcoming public events, and recruitment through the
  existing public membership-interest and program-request forms.
- **News:** posts written by the department.
- **History, minutes and donations:** published History records and photos,
  the public minutes, and a fundraising campaign page.

Also not built: custom pages or a page builder (the owner chose fixed sections
with switches), formatted text, a hero photograph, a canonical URL or sitemap
(the application does not yet know the website's public address), and a
preview of the website from inside the members' application.
