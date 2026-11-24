# The Logbook Docs site

A public website for The Logbook's training guides, setup and administration
documentation, videos and FAQs, built from the Markdown already in this
repository. It is a static site: one unprivileged nginx container with no
database, volumes or secrets.

Nothing here is part of the application. The application's images never
include this folder (the root `.dockerignore` excludes it), and the site never
reads application code.

## Where the content comes from

| Site section           | Source in the repository                                    |
| ---------------------- | ----------------------------------------------------------- |
| Home, Videos, FAQ      | [`content/`](./content/)                                    |
| Training guides        | [`docs/training/`](../docs/training/README.md)              |
| Setup & administration | [`wiki/`](../wiki/Home.md)                                  |
| Reference              | [`docs/`](../docs/README.md), apart from the excluded files |

The guides and wiki pages are published **unedited**: write them so they read
correctly on GitHub, as today. At build time
[`hooks/repo_links.py`](./hooks/repo_links.py) translates their links:

- a relative link, a `github.com/thegspiro/the-logbook/blob/main/...` link or a
  GitHub wiki link to a page the site publishes opens that page on the site;
- a link to anything the site does not publish (source code, an excluded file)
  opens it on GitHub instead of a 404;
- repeated headings get GitHub's anchors (`#release-map-7`), so existing
  `#section` links work.

`exclude_docs` in [`mkdocs.yml`](./mkdocs.yml) lists what is **not** published:
review rotations, audits, agent rules, video scripts and the red-team reports.
Add a path there to keep a new maintainer-only file off the public site.

The navigation is set by the files in [`nav/`](./nav/): the top tabs, the
Reference tab and the wiki's groups. A new training guide or `docs/` page
appears in its tab without any change here; a new wiki page appears once it
matches one of the groups in `nav/wiki.nav.yml` (`Module-*.md`,
`Integration-*.md` and so on) or is added to it.

## Adding a video

Upload the video to YouTube (Public or Unlisted) and copy its id, the 11
characters after `watch?v=` or `shorts/`. Then put a line of its own on
[`content/videos.md`](./content/videos.md), or on any guide page:

```text
!youtube VIDEO_ID Title read out by screen readers
!youtube-short VIDEO_ID Title of a vertical Short
```

The build turns it into a player from `youtube-nocookie.com`, YouTube's
privacy-enhanced domain, which sets no cookies until the visitor plays the
video. A line with a malformed id fails the build. On GitHub the line shows as
plain text, so prefer `content/videos.md` for most videos and put one in a
guide only where it demonstrates that section.

Self-hosting the video files was ruled out: serving large media from a home
connection through a Cloudflare Tunnel is slow for viewers and uses the
upload bandwidth the application also needs.

## Building locally

Needs Python 3.13.

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r docs-site/requirements-dev.txt
sh docs-site/build.sh                     # strict build into docs-site/build/site
python -m pytest docs-site/tests          # hook and CSP tests
mkdocs serve -f docs-site/mkdocs.yml      # live preview at http://127.0.0.1:8000
```

`mkdocs serve` serves the staged copy, so after editing `docs/` or `wiki/` run
`sh docs-site/build.sh --stage-only` again to see the change.

The build is **strict**: a link to a missing page or heading fails it. Material
for MkDocs prints a notice that it reaches end of life on May 5, 2027 (fixes
continue until then); `NO_MKDOCS_2_WARNING=1` hides it. Its successor,
Zensical, reads the same `mkdocs.yml`, so moving is a later, separate change.

## Running it

### Image

`.github/workflows/docs-site.yml` builds the site on every pull request that
changes `docs/`, `wiki/` or `docs-site/`, and on every merge to `main`
publishes `ghcr.io/thegspiro/the-logbook-docs:latest` (and `:sha-<commit>`) for
amd64 and arm64. To build it yourself, from the repository root:

```sh
docker build -f docs-site/Dockerfile -t the-logbook-docs .
```

The build reads [`Dockerfile.dockerignore`](./Dockerfile.dockerignore) instead
of the root `.dockerignore`, which needs BuildKit (the default builder since
Docker 23).

The container listens on **8080** inside. It runs read-only, as a non-root
user, with every capability dropped.

### Unraid

Either install from the template:

1. In **Docker**, choose **Add Container**, and in **Template** paste the URL
   `https://raw.githubusercontent.com/thegspiro/the-logbook/main/docs-site/unraid-template.xml`.
2. Keep **Web Port** at `7882` (or pick any free port) and apply.

or run the compose file with the Compose Manager plugin or from a shell:

```sh
docker compose -f docs-site/docker-compose.yml up -d
```

`DOCS_PORT` changes the host port (default `7882`, next to the application's
`7880`/`7881`).

To pick up new docs after a merge, use **Check for Updates** on the Docker tab
(or `docker compose -f docs-site/docker-compose.yml pull && docker compose -f
docs-site/docker-compose.yml up -d`).

### Cloudflare Tunnel

The site needs no Cloudflare-specific configuration. In your existing tunnel,
add a public hostname for the site and point its service at the container:

| Where `cloudflared` runs                              | Service URL                |
| ----------------------------------------------------- | -------------------------- |
| Another container or host that reaches the Unraid IP  | `http://<unraid-ip>:7882`  |
| A container on the same custom Docker network as this | `http://logbook-docs:8080` |

The service type is **HTTP**, not HTTPS: Cloudflare terminates TLS and the
tunnel carries the traffic to the container. Every link in the site is
relative, so it works on any hostname. `SITE_URL` (a build argument, default
`https://thelogbook.us/`) only sets the sitemap and canonical links; build with
`--build-arg SITE_URL=https://docs.thelogbook.us/` if the site moves to a
subdomain.

The site is public, so no Cloudflare Access policy is needed. If one is added
later, the container needs no change.

### Health check

`GET /healthz` answers `200 ok`. The image's `HEALTHCHECK` uses it, so Unraid
and `docker ps` show the container as healthy once nginx is serving.

## Look

The site wears the application's design: [`content/stylesheets/extra.css`](./content/stylesheets/extra.css)
copies the theme tokens from `frontend/src/styles/index.css` (the slate and
red gradient, white cards, the red-800 primary, alert colours and the
system font), and `content/images/` holds copies of the application's
`logo-128.png` and `favicon.svg` from `frontend/public/`. When the
application's theme or logo changes, update these copies too.

## Security headers

[`nginx/security-headers.conf`](./nginx/security-headers.conf) sets a Content
Security Policy that allows scripts from the site itself plus the theme's few
inline scripts, by hash. [`csp.py`](./csp.py) computes those hashes from the
built pages on every build, so a theme upgrade cannot break search or the
light/dark switch by changing an inline script. Frames are allowed only from
`www.youtube-nocookie.com`.
