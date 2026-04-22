.PHONY: help compose-build compose-up compose-down compose-ui-test-build compose-ui-test-up compose-ui-test-down
help:
	@grep -E '^[a-zA-Z_-]+:' Makefile | grep -v '.PHONY' | sort | while read line; do \
		printf "\033[1;32m%s\033[0m\n" "$$line"; done

# ============================================================
# Docker Compose — Main Services (docker-compose.yml)
# ============================================================

compose-build:
	docker compose -f docker-compose.yml up --build -d

compose-up:
	docker compose -f docker-compose.yml up -d

compose-down:
	docker compose -f docker-compose.yml down

# ============================================================
# Docker Compose — UI Test (docker-compose.ui-test.yml)
# ============================================================

compose-ui-test-build:
	docker compose -f docker-compose.ui-test.yml up --build --abort-on-container-exit --exit-code-from ui-e2e

compose-ui-test-up:
	docker compose -f docker-compose.ui-test.yml up --abort-on-container-exit --exit-code-from ui-e2e

compose-ui-test-down:
	docker compose -f docker-compose.ui-test.yml down
