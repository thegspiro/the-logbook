#!/bin/sh
# MySQL health check script
# Uses environment variables directly, avoiding Docker Compose $$ escaping issues
mysqladmin ping -h localhost -uroot -p"${MYSQL_ROOT_PASSWORD}"
