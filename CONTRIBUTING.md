# Contributing to The Logbook

> **Canonical source.** A copy of this guide is published to the GitHub Wiki
> from [`wiki/Contributing.md`](wiki/Contributing.md). The two are not synced
> automatically — if you change this file, update the wiki page too.

First off, thank you for considering contributing to The Logbook! It's people like you that make this platform a great tool for fire departments and emergency services worldwide.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Creating Modules](#creating-modules)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

Be respectful and constructive. Harassment, personal attacks, and demeaning
comments are not acceptable in issues, pull requests, or any other project
space. Maintainers may edit, remove, or reject contributions that fall short of
this, and may block repeat offenders. Report conduct concerns to the
maintainers using the contact in [SECURITY.md](SECURITY.md).

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples**
- **Describe the behavior you observed and what you expected**
- **Include screenshots if relevant**
- **Include your environment details** (OS, Python version, Node version, browser, etc.)

### Suggesting Features

Feature suggestions are welcome! Please:

- **Use a clear and descriptive title**
- **Provide a detailed description of the suggested feature**
- **Explain why this feature would be useful**
- **Include examples of how it would work**

### Contributing Code

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Write or update tests**
5. **Update documentation**
6. **Commit your changes** (`git commit -m 'Add amazing feature'`)
7. **Push to the branch** (`git push origin feature/amazing-feature`)
8. **Open a Pull Request**

## Development Setup

### Prerequisites

- Python >= 3.11
- MySQL >= 8.0
- Redis >= 7
- Docker & Docker Compose (optional but recommended)

### Quick Start

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/the-logbook.git
cd the-logbook

# Install dependencies
make setup

# Copy environment variables
# Use .env.example for quick setup (~30 vars)
# Use .env.example.full for all options (~100+ vars, includes OAuth, LDAP, S3, HIPAA tuning, etc.)
cp .env.example .env

# Edit .env with your local settings
nano .env

# Start with Docker
make docker-up

# OR start services manually
# Backend:
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload
# Frontend:
cd frontend && npm install && npm run dev
```

### Project Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed information about the project organization.

## Pull Request Process

1. **Update Documentation**: Ensure any new features or changes are documented
2. **Add Tests**: All new code should include appropriate tests
3. **Follow Code Style**: Run `make lint` and `make format`
4. **Update CHANGELOG**: Add your changes to the unreleased section
5. **Pass CI/CD**: Ensure all tests pass in GitHub Actions
6. **Get Reviews**: At least one maintainer must approve your PR
7. **Squash Commits**: Clean up commit history before merging

### PR Title Format

Use conventional commits format:

```
type(scope): description

Examples:
feat(training): add certification expiration alerts
fix(auth): resolve MFA token validation issue
docs(api): update authentication endpoints
chore(deps): update dependencies
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Avoid `any` type - use proper types or `unknown`
- Use interfaces for objects, types for unions/primitives
- Document complex types with JSDoc comments

### Code Style

We use ESLint and Prettier for frontend code formatting, and flake8/mypy for backend:

```bash
# Check linting (frontend)
cd frontend && npm run lint

# Fix linting issues (frontend)
cd frontend && npm run lint:fix

# Format code (frontend)
cd frontend && npm run format

# Check linting (backend)
cd backend && flake8
cd backend && mypy .
```

### Documentation Checks

Two checks run in CI and are worth running locally before opening a PR that
touches Markdown or an API endpoint. Both are pure standard library — no
dependencies to install, and neither imports the application.

```bash
# Every internal Markdown link resolves: in-page anchors, relative file links,
# cross-file anchors, and the extensionless page links used in wiki/
python3 scripts/check_docs_links.py

# Endpoint docstrings agree with the permissions their routes actually enforce
python3 scripts/check_endpoint_permissions.py
```

**Why link checking is a CI gate.** Renaming a heading silently breaks every
link to it — Markdown renders a dead anchor as ordinary text, with no error
anywhere. Nothing else in CI opens a Markdown file.

**Why permissions are checked against docstrings.** An endpoint docstring is
rendered into the interactive API docs at `/docs`, and the wiki's API reference
and the module guides are written from it. A docstring that disagrees with its
own `require_permission(...)` dependency propagates that error into every
document downstream, and it surfaces months later during a documentation pass
rather than at the commit that caused it.

The permission check fails on a docstring that names **different** permissions
than the code enforces, or that claims a permission the route does not require
at all. Routes that merely under-document — code enforces a permission, the
docstring says only "Authentication required" — are reported as warnings; run
with `--list-understated` to see them. If you touch such a route, fixing its
docstring is a welcome drive-by.

### Python (Backend)

- Use Python 3.13+ features where appropriate
- Use type hints for function signatures
- Use `async`/`await` for all database operations (SQLAlchemy async)
- Use `catch (err: unknown)` pattern — never use bare `except:` or `except Exception`
- Always use `HTTPException` for API error responses, never return error tuples
- Follow flake8 rules (configured in `.flake8`, max-line-length=120)

### Best Practices

- **DRY**: Don't Repeat Yourself
- **SOLID**: Follow SOLID principles
- **Error Handling**: Always handle errors appropriately — use `catch (err: unknown)` in TypeScript and typed exceptions in Python
- **Security**: Follow OWASP guidelines
- **Performance**: Consider performance implications
- **Accessibility**: Ensure UI is accessible (WCAG 2.1 AA)

### File Naming

- Use kebab-case for file names: `user-service.ts`
- React components: PascalCase: `UserProfile.tsx`
- Test files: `*.test.ts` or `*.spec.ts`

### Database

- Always create migrations for schema changes
- Include both `up` and `down` migrations
- Test migrations before committing
- Document any data transformations

### API Design

- Follow RESTful principles
- Use proper HTTP status codes
- Version your APIs (`/api/v1/...`)
- Document all endpoints with OpenAPI/Swagger
- Validate all inputs
- Return consistent error formats

## Creating Modules

Modules are feature areas, not plugins. There is no runtime plugin loader and
no per-module manifest file — a module is a frontend directory, a set of
backend endpoints, and two registry entries that make it visible and
toggleable per organization.

1. **Frontend directory** — `frontend/src/modules/<module>/`:

```
frontend/src/modules/my-module/
├── index.ts          # barrel export (routes, store, services, types)
├── routes.tsx        # getMyModuleRoutes() → Fragment of <Route> elements
├── pages/
├── components/
├── services/api.ts   # module API client
├── store/            # Zustand store
└── types/
```

Only `index.ts` and `routes.tsx` are required; the rest appear as the module
grows. Export the route factory from `index.ts` and call it in `App.tsx`.
Build the module's API client with the shared `createApiClient()`
(`frontend/src/utils/createApiClient.ts`) rather than a bare `axios.create()`
— it carries the cookie and CSRF configuration that authenticated requests
need.

2. **Backend** — endpoints in `backend/app/api/v1/endpoints/<module>.py`,
   registered in `backend/app/api/v1/api.py`:

```python
api_router.include_router(
    scheduling.router, prefix="/scheduling", tags=["scheduling"]
)
```

Business logic belongs in `backend/app/services/<module>_service.py`, ORM
models in `models/`, Pydantic schemas in `schemas/`. Guard each route with
`Depends(require_permission("my_module.view"))` and org-scope every query.

3. **Register the module** in both registries:
   - `frontend/src/types/modules.ts` (`AVAILABLE_MODULES`) — id, category
     (`core` / `recommended` / `optional`), icon, route, feature list. The
     category decides whether the module is on by default and whether an
     organization may disable it.
   - `frontend/src/modules/onboarding/config/moduleRegistry.ts` — the single
     source for onboarding, the module overview, and position setup.

   Availability is decided **per organization at runtime** (`enabled_modules`
   in organization settings), which the navigation reads. There are no
   deployment-level module environment flags.

4. **Include tests**: co-located `*.test.tsx` on the frontend, `backend/tests/`
   on the backend.
5. **Document**: a `wiki/Module-<Name>.md` page, plus a guide in
   `docs/training/` if the module is member-facing.

## Testing

### Running Tests

```bash
# All tests
make test

# Backend tests
make test-backend
# or: cd backend && pytest

# Frontend tests
make test-frontend
# or: cd frontend && npx vitest run

# Frontend watch mode
cd frontend && npx vitest

# Frontend coverage
cd frontend && npx vitest run --coverage

# Backend coverage
cd backend && pytest --cov=app --cov-report=term-missing
```

### Writing Tests

- Write tests for all new features
- Maintain or improve code coverage
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)
- Mock external dependencies
- Test edge cases and error conditions

### Test Structure

```typescript
describe("UserService", () => {
  describe("createUser", () => {
    it("should create a new user with valid data", async () => {
      // Arrange
      const userData = { username: "test", email: "test@example.com" };

      // Act
      const result = await userService.createUser(userData);

      // Assert
      expect(result).toBeDefined();
      expect(result.username).toBe("test");
    });

    it("should throw error with duplicate email", async () => {
      // Test error case
    });
  });
});
```

## Documentation

### Code Documentation

- Use JSDoc for functions and classes
- Document complex algorithms
- Explain "why" not "what" in comments
- Keep comments up to date

```typescript
/**
 * Verifies the integrity of audit log chain
 *
 * @param startId - First log entry ID to verify
 * @param endId - Last log entry ID to verify
 * @returns Verification results with any errors found
 * @throws {DatabaseError} If unable to access audit logs
 */
async function verifyLogIntegrity(
  startId: number,
  endId: number,
): Promise<VerificationResult> {
  // Implementation
}
```

### User Documentation

- Update relevant docs in `/docs`
- Include screenshots for UI features
- Provide examples and use cases
- Keep language clear and concise

### API Documentation

- Document all endpoints with OpenAPI/Swagger
- Include request/response examples
- Document error responses
- Keep API docs synchronized with code

## Security

- Never commit secrets or credentials
- Use environment variables for configuration
- Sanitize all user inputs
- Follow principle of least privilege
- Report security vulnerabilities privately to security@intranet-platform.org

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

- Open a [Discussion](https://github.com/thegspiro/the-logbook/discussions)
- Join our [Community Forum](https://community.the-logbook.org)
- Email: dev@the-logbook.org

## Recognition

Contributors will be recognized in:

- README.md contributors section
- Release notes
- Annual contributor highlights

Thank you for contributing! 🎉
