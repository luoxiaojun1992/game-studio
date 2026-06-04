.PHONY: help loc loc-verbose compose-build compose-up compose-down compose-ui-test-build compose-ui-test-up compose-ui-test-down compose-ui-test
help:
	@grep -E '^[a-zA-Z_-]+:' Makefile | grep -v '.PHONY' | sort | while read line; do \
		printf "\033[1;32m%s\033[0m\n" "$$line"; done

# ============================================================
# Code Statistics — Lines of Code (pure bash, no dependencies)
# ============================================================
#
#   make loc          # summary by language
#   make loc-verbose  # + top 20 largest files
#
# Script: scripts/loc.sh
# Excludes: node_modules/, dist/, build/, __pycache__/,
#   lock files, minified files, binary assets, sourcemaps

loc:
	@bash scripts/loc.sh

loc-verbose:
	@bash scripts/loc.sh -v

# ============================================================
# Docker Compose — Main Services (docker-compose.yml)
# ============================================================

compose-build:
	docker compose -f docker-compose.yml build --no-cache
	docker compose -f docker-compose.yml up -d

compose-up:
	docker compose -f docker-compose.yml up -d

compose-down:
	docker compose -f docker-compose.yml down

# ============================================================
# Docker Compose — UI Test (docker-compose.ui-test.yml)
# ============================================================

compose-ui-test-build:
	docker compose -f docker-compose.ui-test.yml build --no-cache

compose-ui-test:
	docker compose -f docker-compose.ui-test.yml up --abort-on-container-exit --exit-code-from ui-e2e

compose-ui-test-up:
	docker compose -f docker-compose.ui-test.yml up --abort-on-container-exit --exit-code-from ui-e2e

compose-ui-test-down:
	docker compose -f docker-compose.ui-test.yml down
