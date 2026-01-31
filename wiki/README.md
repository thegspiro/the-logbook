# GitHub Wiki Setup for The Logbook

This directory contains all the wiki pages for The Logbook project. These pages are designed to be deployed to the GitHub Wiki.

---

## 📚 What's Included

### Core Pages
- **Home.md** - Wiki home page with overview and navigation
- **_Sidebar.md** - Navigation sidebar for all wiki pages

### Getting Started
- **Installation.md** - Complete installation guide for all platforms
- **Unraid-Quick-Start.md** - One-command Unraid installation
- **Onboarding.md** - First-time setup wizard guide
- **Quick-Reference.md** - Common commands and quick solutions

### Deployment & Configuration
- **Deployment-Unraid.md** - Complete Unraid deployment guide
- **Configuration-Environment.md** - Environment variables reference
- **Configuration-Modules.md** - Module configuration
- **Configuration-Security.md** - Security settings

### Development
- **Development-Backend.md** - Python/FastAPI backend development
- **Development-Frontend.md** - React/TypeScript frontend development
- **Contributing.md** - Contribution guidelines

### Security
- **Security-Overview.md** - Security policy and compliance
- **Security-Authentication.md** - Auth systems (OAuth, SAML, LDAP, MFA)
- **Security-Encryption.md** - Encryption implementation
- **Security-Audit-Logging.md** - Tamper-proof audit trails
- **Security-HIPAA.md** - HIPAA compliance guide

### Troubleshooting
- **Troubleshooting.md** - Common issues and solutions
- **Troubleshooting-Containers.md** - Docker container issues
- **Troubleshooting-Frontend.md** - Frontend issues
- **Troubleshooting-Backend.md** - Backend API issues
- **Troubleshooting-Database.md** - Database connection issues

### Reference
- **Role-System.md** - RBAC documentation
- **API-Reference.md** - Complete API documentation
- **Database-Schema.md** - Database structure
- **Technology-Stack.md** - Tech stack details

---

## 🚀 Quick Setup (Automated)

### Method 1: Using the Setup Script (Recommended)

```bash
cd wiki
./setup-wiki.sh
```

This will:
1. Clone your GitHub Wiki repository
2. Copy all wiki pages
3. Commit and push to GitHub
4. Display the wiki URL

**Done!** Your wiki is now live at: `https://github.com/thegspiro/the-logbook/wiki`

---

## 📖 Manual Setup

If you prefer to set up the wiki manually:

### Step 1: Enable Wiki on GitHub

1. Go to https://github.com/thegspiro/the-logbook/settings
2. Scroll to "Features" section
3. Check "✓ Wikis"
4. Click "Save"

### Step 2: Clone Wiki Repository

```bash
# Clone the wiki repo (separate from main repo)
git clone https://github.com/thegspiro/the-logbook.wiki.git
cd the-logbook.wiki
```

### Step 3: Copy Wiki Pages

```bash
# Copy all wiki files from this directory
cp /path/to/the-logbook/wiki/*.md .
```

### Step 4: Commit and Push

```bash
# Add all files
git add .

# Commit
git commit -m "Initial wiki setup with comprehensive documentation"

# Push to GitHub
git push origin master
```

### Step 5: Verify

Visit: https://github.com/thegspiro/the-logbook/wiki

---

## 🔄 Updating the Wiki

### Automated Update

```bash
cd wiki
./setup-wiki.sh
```

### Manual Update

```bash
# Make changes to wiki/*.md files
# Then:

cd ../the-logbook.wiki
cp ../the-logbook/wiki/*.md .
git add .
git commit -m "Update wiki pages"
git push origin master
```

---

## 📝 Adding New Wiki Pages

### 1. Create the Page

Create a new markdown file in the `wiki/` directory:

```bash
cd wiki
nano My-New-Page.md
```

### 2. Add to Sidebar

Edit `_Sidebar.md` and add your page:

```markdown
### My Section
- [My New Page](My-New-Page)
```

### 3. Link from Other Pages

Link to your page from relevant pages:

```markdown
See [My New Page](My-New-Page) for more details.
```

### 4. Deploy

```bash
./setup-wiki.sh
```

---

## 🎨 Wiki Page Guidelines

### File Naming

- Use `Title-Case-With-Hyphens.md`
- No spaces in filenames
- Use descriptive names

**Examples:**
- ✅ `Deployment-Unraid.md`
- ✅ `Configuration-Environment.md`
- ❌ `deployment unraid.md`
- ❌ `config.md`

### Page Structure

```markdown
# Page Title

Brief introduction paragraph.

---

## Section 1

Content here...

### Subsection 1.1

More details...

---

## Section 2

More content...

---

**See also:** [Related Page 1](Page-1) | [Related Page 2](Page-2)
```

### Internal Links

```markdown
[Link Text](Page-Name)
```

**Example:**
```markdown
See the [Installation Guide](Installation) for setup instructions.
```

### External Links

```markdown
[Link Text](https://full-url.com)
```

### Images

```markdown
![Alt Text](https://url-to-image.png)
```

Or use relative paths if images are in the wiki:
```markdown
![Screenshot](images/screenshot.png)
```

### Code Blocks

````markdown
```bash
docker-compose up -d
```
````

### Tables

```markdown
| Column 1 | Column 2 |
|----------|----------|
| Value 1  | Value 2  |
```

### Alerts/Callouts

```markdown
**⚠️ Warning:** Important information

**✅ Tip:** Helpful suggestion

**❌ Don't:** What to avoid
```

---

## 🗂️ Wiki Structure

### Current Organization

```
Home.md (landing page)
├── Getting Started
│   ├── Installation
│   ├── Unraid-Quick-Start
│   ├── Onboarding
│   └── Quick-Reference
├── Deployment
│   ├── Deployment-Unraid
│   ├── Deployment-Docker
│   └── Deployment-Production
├── Configuration
│   ├── Configuration-Environment
│   ├── Configuration-Modules
│   └── Configuration-Security
├── Development
│   ├── Development-Backend
│   ├── Development-Frontend
│   └── Contributing
├── Modules
│   ├── Module-Training
│   ├── Module-Elections
│   └── ...
├── Security
│   ├── Security-Overview
│   ├── Security-Authentication
│   └── ...
├── Troubleshooting
│   ├── Troubleshooting
│   ├── Troubleshooting-Containers
│   └── ...
└── Reference
    ├── API-Reference
    ├── Database-Schema
    └── ...
```

---

## 🔧 Maintenance

### Syncing with Documentation

When main documentation files are updated:

```bash
# Copy updated files to wiki directory
cp ../docs/troubleshooting/README.md Troubleshooting.md
cp ../docs/backend/python-backend.md Development-Backend.md
cp ../SECURITY.md Security-Overview.md

# Deploy to GitHub
./setup-wiki.sh
```

### Regular Updates

Recommended schedule:
- Update wiki after major releases
- Sync documentation monthly
- Review and update troubleshooting quarterly

---

## 📋 Checklist for New Wiki Pages

- [ ] Create `.md` file with proper naming
- [ ] Add clear title and introduction
- [ ] Include code examples where appropriate
- [ ] Add internal links to related pages
- [ ] Update `_Sidebar.md` with new page link
- [ ] Link from relevant existing pages
- [ ] Test all links after deployment
- [ ] Run `./setup-wiki.sh` to deploy

---

## 🐛 Troubleshooting Wiki Setup

### Permission Denied When Pushing

```bash
# Make sure you're authenticated with GitHub
gh auth login

# Or use SSH
git remote set-url origin git@github.com:thegspiro/the-logbook.wiki.git
```

### Wiki Not Enabled

1. Go to repository Settings
2. Check "Wikis" under Features
3. Save changes
4. Try cloning again

### Changes Not Showing

- Clear browser cache
- Wait a few seconds for GitHub to rebuild
- Check you pushed to `master` branch
- Verify files were committed: `git log`

### Script Fails

```bash
# Run with debug output
bash -x setup-wiki.sh

# Check permissions
chmod +x setup-wiki.sh

# Ensure you're in wiki directory
pwd  # Should end with /wiki
```

---

## 📊 Wiki Statistics

Current pages: **12+**
Total lines: **~3,000+**
Coverage:
- ✅ Installation & Setup
- ✅ Deployment (all platforms)
- ✅ Configuration
- ✅ Development
- ✅ Security
- ✅ Troubleshooting
- ✅ API Reference

---

## 🤝 Contributing to Wiki

See **[Contributing Guide](../CONTRIBUTING.md)** for guidelines.

Wiki-specific tips:
- Keep pages focused on one topic
- Use clear, simple language
- Include lots of code examples
- Add screenshots where helpful
- Update sidebar when adding pages
- Test all internal links

---

## 🔗 Useful Links

- **GitHub Wiki:** https://github.com/thegspiro/the-logbook/wiki
- **Main Repository:** https://github.com/thegspiro/the-logbook
- **Issues:** https://github.com/thegspiro/the-logbook/issues
- **Discussions:** https://github.com/thegspiro/the-logbook/discussions

---

## 📞 Need Help?

- **GitHub Wiki Docs:** https://docs.github.com/en/communities/documenting-your-project-with-wikis
- **Markdown Guide:** https://www.markdownguide.org/
- **Create Issue:** https://github.com/thegspiro/the-logbook/issues/new

---

**Ready to deploy?** Run `./setup-wiki.sh` and your wiki will be live in seconds! 🚀
