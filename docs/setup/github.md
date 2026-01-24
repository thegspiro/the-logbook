# 📦 GitHub Repository Setup Guide

## Your Repository

**Repository URL:** https://github.com/thegspiro/the-logbook

This guide will help you set up and deploy The Logbook to your GitHub repository.

---

## 🚀 Initial Setup

### 1. Clone the Project Locally

```bash
# Navigate to where you want the project
cd ~/projects

# Clone your repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
```

### 2. Copy Project Files

Copy all the files from the `intranet-platform` folder into your cloned repository:

```bash
# If the project files are in a different location
cp -r /path/to/intranet-platform/* .
cp -r /path/to/intranet-platform/.* .  # Don't forget hidden files!

# Or manually copy:
# - All files and folders
# - .gitignore
# - .github/
# - .env.example
```

### 3. Initial Git Setup

```bash
# Check what files will be committed
git status

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: The Logbook platform"

# Push to GitHub
git push origin main
```

---

## 🔐 Configure GitHub Secrets

For CI/CD to work, you need to set up GitHub Secrets:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

### Required Secrets

#### Database Secrets
```
DB_NAME=the_logbook_production
DB_USER=logbook_user
DB_PASSWORD=<strong-random-password>
```

#### Application Secrets
```
SECRET_KEY=<64-character-random-string>
ENCRYPTION_KEY=<32-byte-hex-string>
```

#### Email Configuration (if using SMTP)
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

#### Optional: Cloud Deployment
```
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
# OR
AZURE_CREDENTIALS=<service-principal-json>
# OR
GCP_SA_KEY=<service-account-json>
```

### Generate Secure Keys

```bash
# Generate SECRET_KEY (64 characters)
python -c "import secrets; print(secrets.token_urlsafe(48))"

# Generate ENCRYPTION_KEY (32 bytes hex)
python -c "import secrets; print(secrets.token_hex(32))"

# Generate a strong password
python -c "import secrets, string; chars = string.ascii_letters + string.digits + string.punctuation; print(''.join(secrets.choice(chars) for _ in range(32)))"
```

---

## 📝 Update Repository-Specific Files

### 1. Update README.md

Add your specific information:

```markdown
# The Logbook

> A secure, modular intranet platform for fire departments and emergency services

**Maintained by:** [Your Name/Organization]
**License:** MIT
**Status:** In Development
```

### 2. Create LICENSE File

```bash
# MIT License example
cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2024 [Your Name]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction...
EOF
```

### 3. Add CODEOWNERS (Optional)

Create `.github/CODEOWNERS`:

```
# Default owners for everything
* @thegspiro

# Specific areas
/backend/ @thegspiro
/frontend/ @thegspiro
/docs/ @thegspiro
```

---

## 🏷️ Branching Strategy

Recommended Git workflow:

```bash
main          # Production-ready code
├── develop   # Integration branch
    ├── feature/training-module
    ├── feature/compliance-module
    └── bugfix/login-issue
```

### Create Development Branch

```bash
# Create and switch to develop branch
git checkout -b develop

# Push to GitHub
git push -u origin develop
```

### Branch Protection Rules

1. Go to **Settings** → **Branches**
2. Add rule for `main`:
   - ✅ Require pull request reviews (1 approver)
   - ✅ Require status checks to pass
   - ✅ Require branches to be up to date
   - ✅ Include administrators

---

## 🔄 CI/CD Pipeline

The project includes GitHub Actions workflows in `.github/workflows/`:

### Workflows Included

1. **`ci.yml`** - Continuous Integration
   - Runs on every push/PR
   - Lints code
   - Runs tests
   - Security scanning
   - Builds Docker images

2. **`security-scan.yml`** (create this)
   - Dependency scanning
   - SAST (Static Application Security Testing)
   - Secret scanning

### Enable GitHub Actions

1. Go to **Actions** tab in your repository
2. Click "I understand my workflows, go ahead and enable them"
3. Workflows will run automatically on push/PR

### View Build Status

Add badges to your README:

```markdown
[![CI/CD](https://github.com/thegspiro/the-logbook/actions/workflows/ci.yml/badge.svg)](https://github.com/thegspiro/the-logbook/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
```

---

## 📦 Releases

### Creating a Release

```bash
# Tag a version
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

On GitHub:
1. Go to **Releases** → **Draft a new release**
2. Choose the tag (v1.0.0)
3. Write release notes
4. Publish release

### Semantic Versioning

Follow [semver.org](https://semver.org/):

- **v1.0.0** - Major release
- **v1.1.0** - Minor release (new features)
- **v1.1.1** - Patch release (bug fixes)

---

## 📋 Issues and Project Management

### Issue Templates

Create `.github/ISSUE_TEMPLATE/`:

**bug_report.yml:**
```yaml
name: Bug Report
description: File a bug report
labels: ["bug"]
body:
  - type: textarea
    id: description
    attributes:
      label: Bug Description
      placeholder: What happened?
    validations:
      required: true
```

**feature_request.yml:**
```yaml
name: Feature Request
description: Suggest a new feature
labels: ["enhancement"]
body:
  - type: textarea
    id: description
    attributes:
      label: Feature Description
      placeholder: What would you like to see?
    validations:
      required: true
```

### GitHub Projects

1. Go to **Projects** tab
2. Create new project: "The Logbook Development"
3. Add views:
   - **Kanban**: To Do, In Progress, Done
   - **Timeline**: Roadmap view
   - **Table**: All issues

---

## 🚢 Deployment Options

### Option 1: Deploy to Your Own Server

```bash
# On your server
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env
# Edit .env with production values
docker-compose -f docker-compose.prod.yml up -d
```

### Option 2: Deploy to Cloud Platform

**Heroku:**
```bash
heroku create the-logbook
heroku addons:create heroku-postgresql:hobby-dev
heroku addons:create heroku-redis:hobby-dev
git push heroku main
```

**DigitalOcean App Platform:**
- Connect GitHub repository
- Configure environment variables
- Deploy automatically on push

**AWS ECS/Fargate:**
- Use provided Terraform configurations
- Set up in `infrastructure/terraform/providers/aws/`

### Option 3: GitHub Pages (Frontend Only)

For documentation or a demo frontend:

```bash
# Build frontend
cd frontend
npm run build

# Deploy to gh-pages branch
npm install -g gh-pages
gh-pages -d dist
```

Enable in **Settings** → **Pages** → Source: `gh-pages` branch

---

## 🔒 Security Best Practices

### 1. Enable Security Features

In **Settings** → **Security**:
- ✅ Dependabot alerts
- ✅ Dependabot security updates
- ✅ Code scanning (CodeQL)
- ✅ Secret scanning

### 2. Add SECURITY.md

```markdown
# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities to: security@yourproject.org

Do NOT create public issues for security vulnerabilities.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
```

### 3. Review Dependencies Regularly

```bash
# Check for vulnerabilities
pip-audit  # For Python
npm audit  # For Node.js

# Update dependencies
pip-review --auto  # Python
npm update  # Node.js
```

---

## 📊 Monitoring and Analytics

### GitHub Insights

Use **Insights** tab to track:
- Contributors
- Commit activity
- Traffic (if public)
- Community health

### Add Badges

```markdown
![GitHub Stars](https://img.shields.io/github/stars/thegspiro/the-logbook?style=social)
![GitHub Forks](https://img.shields.io/github/forks/thegspiro/the-logbook?style=social)
![GitHub Issues](https://img.shields.io/github/issues/thegspiro/the-logbook)
![GitHub Pull Requests](https://img.shields.io/github/issues-pr/thegspiro/the-logbook)
```

---

## 📚 Documentation

### GitHub Wiki

1. Enable Wiki in **Settings**
2. Create pages:
   - Home (overview)
   - Installation Guide
   - Configuration Guide
   - API Documentation
   - FAQ

### GitHub Pages for Docs

```bash
# Use MkDocs or Sphinx
pip install mkdocs-material
mkdocs new .
mkdocs gh-deploy
```

---

## 🤝 Community

### Contributing Guidelines

Already included in `CONTRIBUTING.md` - make sure to:
1. Update with your specific workflow
2. Add code of conduct
3. Add contributor license agreement (if needed)

### Discussion Board

Enable **Discussions** in repository settings:
- General
- Ideas
- Q&A
- Show and Tell

---

## ✅ Checklist for Going Public

Before making the repository public:

- [ ] Remove all sensitive data
- [ ] Update .gitignore
- [ ] Add comprehensive README
- [ ] Add LICENSE file
- [ ] Add CONTRIBUTING.md
- [ ] Add CODE_OF_CONDUCT.md
- [ ] Set up issue templates
- [ ] Configure branch protection
- [ ] Enable security features
- [ ] Test CI/CD pipeline
- [ ] Add documentation
- [ ] Create initial release (v1.0.0)

---

## 📞 Support

If you need help:
- **GitHub Issues**: https://github.com/thegspiro/the-logbook/issues
- **Discussions**: https://github.com/thegspiro/the-logbook/discussions
- **Email**: [your-email@example.com]

---

**Ready to push to GitHub?**

```bash
git remote -v  # Verify remote is correct
git push -u origin main
```

🎉 **Your project is now on GitHub!**
