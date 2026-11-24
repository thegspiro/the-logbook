# The Logbook documentation site: a static site built with MkDocs and served by
# unprivileged nginx on port 8080.
#
# Build from the REPOSITORY ROOT, since the site is assembled from docs/ and
# wiki/:
#   docker build -f docs-site/Dockerfile -t the-logbook-docs .
# docs-site/Dockerfile.dockerignore limits the context to what is read here.

FROM python:3.13-slim AS build
WORKDIR /src
COPY docs-site/requirements.txt docs-site/requirements.txt
RUN pip install --no-cache-dir -r docs-site/requirements.txt
COPY docs docs
COPY wiki wiki
COPY docs-site docs-site
ARG SITE_URL=https://thelogbook.us/
ENV SITE_URL=${SITE_URL} \
    NO_MKDOCS_2_WARNING=1
RUN sh docs-site/build.sh \
    # Compressed copies served by gzip_static, so nginx never compresses the
    # 11 MB search index per request.
    && find docs-site/build/site -type f \
        \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.json' \
           -o -name '*.svg' -o -name '*.xml' \) \
        -exec gzip -9 -k -f {} +

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY docs-site/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/docs-site/build/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /src/docs-site/build/site /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
