# Intranet Platform - Makefile
# Common commands for development and deployment

.PHONY: help setup install dev build test clean docker-* db-*

# Default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

## help: Display this help message
help:
	@echo "${BLUE}Intranet Platform - Available Commands${NC}"
	@echo ""
	@grep -E '^## [a-zA-Z_-]+:.*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = "## |:"}; {printf "${GREEN}%-20s${NC} %s\n", $$2, $$3}'

## setup: Initial project setup
setup:
	@echo "${BLUE}Setting up project...${NC}"
	@cp .env.example .env 2>/dev/null || true
	@npm install
	@cd backend && pip install -r requirements.txt
	@cd frontend && npm install
	@echo "${GREEN}✓ Setup complete! Edit .env file with your configuration.${NC}"

## install: Install dependencies
install:
	@echo "${BLUE}Installing dependencies...${NC}"
	@npm install
	@echo "${GREEN}✓ Dependencies installed${NC}"

## dev: Start development servers
dev:
	@echo "${BLUE}Starting development servers...${NC}"
	@npm run dev

## build: Build production bundles
build:
	@echo "${BLUE}Building production bundles...${NC}"
	@npm run build
	@echo "${GREEN}✓ Build complete${NC}"

## test: Run all tests
test:
	@echo "${BLUE}Running tests...${NC}"
	@npm test

## test-backend: Run backend tests
test-backend:
	@echo "${BLUE}Running backend tests...${NC}"
	@cd backend && pytest

## test-frontend: Run frontend tests
test-frontend:
	@echo "${BLUE}Running frontend tests...${NC}"
	@cd frontend && npm test

## lint: Lint all code
lint:
	@echo "${BLUE}Linting code...${NC}"
	@npm run lint

## format: Format all code
format:
	@echo "${BLUE}Formatting code...${NC}"
	@npm run format
	@echo "${GREEN}✓ Code formatted${NC}"

## clean: Clean build artifacts and dependencies
clean:
	@echo "${RED}Cleaning project...${NC}"
	@rm -rf node_modules frontend/node_modules
	@rm -rf frontend/dist
	@find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@rm -rf backend/.pytest_cache
	@echo "${GREEN}✓ Clean complete${NC}"

## docker-build: Build Docker images
docker-build:
	@echo "${BLUE}Building Docker images...${NC}"
	@docker-compose build
	@echo "${GREEN}✓ Docker images built${NC}"

## docker-up: Start Docker containers
docker-up:
	@echo "${BLUE}Starting Docker containers...${NC}"
	@docker-compose up -d
	@echo "${GREEN}✓ Containers started${NC}"
	@echo "${YELLOW}Frontend: http://localhost:3000${NC}"
	@echo "${YELLOW}Backend:  http://localhost:3001${NC}"

## docker-down: Stop Docker containers
docker-down:
	@echo "${BLUE}Stopping Docker containers...${NC}"
	@docker-compose down
	@echo "${GREEN}✓ Containers stopped${NC}"

## docker-logs: View Docker logs
docker-logs:
	@docker-compose logs -f

## docker-clean: Remove Docker containers and volumes
docker-clean:
	@echo "${RED}Removing Docker containers and volumes...${NC}"
	@docker-compose down -v
	@echo "${GREEN}✓ Docker cleanup complete${NC}"

## db-migrate: Run database migrations
db-migrate:
	@echo "${BLUE}Running database migrations...${NC}"
	@cd backend && alembic upgrade head
	@echo "${GREEN}✓ Migrations complete${NC}"

## db-rollback: Rollback last migration
db-rollback:
	@echo "${YELLOW}Rolling back last migration...${NC}"
	@cd backend && alembic downgrade -1
	@echo "${GREEN}✓ Rollback complete${NC}"

## db-seed: Seed database with sample data
db-seed:
	@echo "${BLUE}Seeding database...${NC}"
	@cd backend && python scripts/seed_data.py
	@echo "${GREEN}✓ Database seeded${NC}"

## db-reset: Reset database (rollback, migrate, seed)
db-reset:
	@echo "${YELLOW}Resetting database...${NC}"
	@$(MAKE) db-rollback
	@$(MAKE) db-migrate
	@$(MAKE) db-seed
	@echo "${GREEN}✓ Database reset complete${NC}"

## logs: View application logs
logs:
	@tail -f backend/logs/*.log

## security-check: Run security audit
security-check:
	@echo "${BLUE}Running security audit...${NC}"
	@npm audit
	@cd frontend && npm audit
	@cd backend && pip audit 2>/dev/null || echo "${YELLOW}pip-audit not installed, skipping backend audit${NC}"

## update-deps: Update dependencies
update-deps:
	@echo "${BLUE}Updating dependencies...${NC}"
	@npm update
	@cd frontend && npm update
	@cd backend && pip install --upgrade -r requirements.txt
	@echo "${GREEN}✓ Dependencies updated${NC}"

## generate-keys: Generate encryption keys
generate-keys:
	@echo "${BLUE}Generating encryption keys...${NC}"
	@./scripts/setup/generate-keys.sh
	@echo "${GREEN}✓ Keys generated${NC}"

## backup: Backup database
backup:
	@echo "${BLUE}Creating database backup...${NC}"
	@./scripts/deployment/backup.sh
	@echo "${GREEN}✓ Backup complete${NC}"

## deploy: Deploy to production
deploy:
	@echo "${BLUE}Deploying to production...${NC}"
	@./scripts/deployment/deploy.sh
	@echo "${GREEN}✓ Deployment complete${NC}"

## verify-integrity: Verify audit log integrity
verify-integrity:
	@echo "${BLUE}Verifying audit log integrity...${NC}"
	@./scripts/maintenance/verify-integrity.sh
	@echo "${GREEN}✓ Integrity verification complete${NC}"
