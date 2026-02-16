# The Logbook - Unraid Community Applications Submission Guide

Complete guide for submitting The Logbook to Unraid Community Applications.

## Prerequisites

Before submitting, ensure you have:

- [x] Docker image published to public registry (Docker Hub, GitHub Container Registry, etc.)
- [x] XML template tested and working
- [x] Icon/logo image (256x256 PNG, publicly accessible URL)
- [x] Screenshots for Community Apps page
- [x] Documentation complete
- [x] GitHub repository public (or accessible)

---

## Required Files

### 1. XML Template (`the-logbook.xml`)

**Location:** `/unraid/the-logbook.xml`

**Requirements:**
- ✅ Valid XML format
- ✅ All required fields populated
- ✅ Port mappings conflict-free
- ✅ Volume mappings use Unraid conventions
- ✅ Environment variables documented
- ✅ Support URLs included
- ✅ Icon URL publicly accessible

**Validation:**
```bash
# Test XML syntax
xmllint --noout the-logbook.xml

# Test on Unraid
cp the-logbook.xml /boot/config/plugins/dockerMan/templates-user/
# Then test installation through Unraid UI
```

### 2. Icon/Logo

**Requirements:**
- Format: PNG
- Size: 256x256 pixels
- Background: Transparent preferred
- Public URL: GitHub raw or CDN

**Recommended hosting:**
```
https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/icon.png
```

**Tips:**
- Keep file size under 100KB
- Use simple, recognizable design
- Should look good on dark background (Unraid default)
- No text if possible (unless part of brand)

### 3. Screenshots

**Recommended screenshots (in order):**
1. Dashboard/Home page
2. Main feature interface
3. Mobile responsive view
4. Settings/configuration page
5. Reports/analytics (if applicable)

**Requirements:**
- Format: PNG or JPG
- Size: 1920x1080 or 1280x720
- Clear, high quality
- No sensitive/personal data visible
- Hosted publicly (GitHub, Imgur, etc.)

**Example hosting:**
```
https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/screenshots/
├── screenshot-1-dashboard.png
├── screenshot-2-events.png
├── screenshot-3-mobile.png
└── screenshot-4-settings.png
```

### 4. Documentation

**Required docs in `/unraid/` directory:**
- [x] `UNRAID-INSTALLATION.md` - Installation guide
- [x] `the-logbook.xml` - Docker template
- [x] `docker-compose-unraid.yml` - Alternative installation
- [x] `README.md` - Overview and quick links

---

## Submission Process

### Step 1: Prepare Repository

1. **Create `/unraid/` directory structure:**
   ```
   unraid/
   ├── the-logbook.xml              # Docker template
   ├── UNRAID-INSTALLATION.md       # Installation guide
   ├── docker-compose-unraid.yml    # Docker compose
   ├── COMMUNITY-APP-SUBMISSION.md  # This file
   ├── README.md                    # Overview
   ├── icon.png                     # 256x256 logo
   └── screenshots/
       ├── screenshot-1.png
       ├── screenshot-2.png
       └── ...
   ```

2. **Test XML template:**
   - Copy to Unraid server
   - Install through Docker template
   - Verify all settings work
   - Test startup and functionality

3. **Update XML URLs:**
   ```xml
   <TemplateURL>https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/the-logbook.xml</TemplateURL>
   <Icon>https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/icon.png</Icon>
   <Repository>ghcr.io/thegspiro/the-logbook:latest</Repository>
   <Support>https://github.com/thegspiro/the-logbook/issues</Support>
   <Project>https://github.com/thegspiro/the-logbook</Project>
   ```

### Step 2: Fork Community Applications Repository

1. Go to: https://github.com/Squidly271/AppFeed

2. Click **Fork** button

3. Clone your fork:
   ```bash
   git clone https://github.com/thegspiro/AppFeed.git
   cd AppFeed
   ```

### Step 3: Add Your Template

1. **Find appropriate directory:**
   ```
   AppFeed/
   └── templates/
       └── thegspiro/           # Create if doesn't exist
           └── the-logbook.xml
   ```

2. **Copy your XML template:**
   ```bash
   mkdir -p templates/thegspiro
   cp /path/to/your/the-logbook.xml templates/thegspiro/
   ```

3. **Verify XML is valid:**
   ```bash
   # Check XML syntax
   xmllint --noout templates/thegspiro/the-logbook.xml

   # Check for common issues
   grep -E "(localhost|127\.0\.0\.1|192\.168)" templates/thegspiro/the-logbook.xml
   # Should not have hardcoded local IPs
   ```

### Step 4: Create Pull Request

1. **Commit your template:**
   ```bash
   git add templates/thegspiro/the-logbook.xml
   git commit -m "Add The Logbook - Intranet platform for emergency services"
   ```

2. **Push to your fork:**
   ```bash
   git push origin main
   ```

3. **Create Pull Request:**
   - Go to your fork on GitHub
   - Click **Contribute** → **Open pull request**
   - Title: `Add The Logbook application`
   - Description:
     ```markdown
     ## Application: The Logbook

     **Category:** Productivity

     **Description:**
     Comprehensive intranet platform for fire departments, EMS, and emergency
     services. Features include member management, training tracking, equipment
     inventory, scheduling, elections, QR code check-ins, and more.

     **Support Thread:** [Link to Unraid forums if available]

     **Testing:**
     - [x] Template tested on Unraid 6.12.4
     - [x] All environment variables documented
     - [x] Ports conflict-free (7880, 7881)
     - [x] Volume mappings follow Unraid conventions
     - [x] Icon publicly accessible
     - [x] Documentation complete

     **Links:**
     - Repository: https://github.com/thegspiro/the-logbook
     - Documentation: https://github.com/thegspiro/the-logbook/tree/main/unraid
     - Docker Image: ghcr.io/thegspiro/the-logbook:latest
     ```

4. **Wait for review:**
   - Community Apps maintainers will review
   - May request changes
   - Address feedback promptly
   - Once approved, template will be merged

### Step 5: Create Unraid Forums Support Thread

1. **Go to:** https://forums.unraid.net/forum/56-docker-containers/

2. **Create new topic:**
   - Title: `[Support] The Logbook - Intranet Platform`
   - Category: Docker Containers

3. **Post template:**
   ```markdown
   # The Logbook - Support Thread

   ## Overview
   The Logbook is a comprehensive, modular intranet platform designed for
   fire departments, EMS, and emergency services organizations.

   ## Features
   - Member management
   - Training tracking
   - Equipment inventory
   - Event scheduling
   - Elections management
   - QR code check-ins
   - And more...

   ## Installation
   Available in Community Applications - search for "The Logbook"

   ## Documentation
   - [Installation Guide](https://github.com/thegspiro/the-logbook/blob/main/unraid/UNRAID-INSTALLATION.md)
   - [Troubleshooting](link)
   - [GitHub Repository](https://github.com/thegspiro/the-logbook)

   ## System Requirements
   - Unraid 6.9.0+
   - 8GB RAM minimum
   - MySQL 8.0 database

   ## Support
   Post questions and issues in this thread. For bugs, please use
   [GitHub Issues](https://github.com/thegspiro/the-logbook/issues)

   ## Screenshots
   [Post 3-5 screenshots showing main features]
   ```

4. **Update XML with support URL:**
   ```xml
   <Support>https://forums.unraid.net/topic/XXXXX-support-the-logbook/</Support>
   ```

---

## Submission Checklist

### Pre-Submission

- [ ] Docker image published and publicly accessible
- [ ] XML template tested on Unraid
- [ ] All ports conflict-free (default: 7880, 7881)
- [ ] Volume paths use `/mnt/user/appdata/` convention
- [ ] Environment variables documented
- [ ] Icon uploaded and publicly accessible (256x256 PNG)
- [ ] Screenshots prepared (at least 3)
- [ ] Documentation complete
- [ ] README.md in `/unraid/` directory
- [ ] Installation guide written
- [ ] Troubleshooting guide written

### XML Template Quality

- [ ] No hardcoded IPs (use [IP] placeholder)
- [ ] No hardcoded ports in descriptions (use [PORT:xxxx])
- [ ] All required environment variables included
- [ ] Optional variables marked as "Display: advanced"
- [ ] Passwords fields have "Mask: true"
- [ ] Sensible defaults provided
- [ ] Category appropriate (Productivity, Status:Stable)
- [ ] Support URL points to forum thread
- [ ] Project URL points to GitHub
- [ ] Icon URL publicly accessible
- [ ] Repository URL correct
- [ ] WebUI template uses placeholders: `http://[IP]:[PORT:7880]`

### Testing Checklist

- [ ] Fresh installation works
- [ ] Container starts without errors
- [ ] WebUI accessible
- [ ] Database connection works
- [ ] Health check passes
- [ ] Logs show no errors
- [ ] Can create user account
- [ ] Basic functionality works
- [ ] Restart persists data
- [ ] Backup/restore works
- [ ] Update doesn't break configuration

### Documentation Quality

- [ ] Installation guide clear and detailed
- [ ] Database setup instructions included
- [ ] Port conflict resolution documented
- [ ] Troubleshooting section comprehensive
- [ ] Common issues addressed
- [ ] Examples provided
- [ ] Screenshots show key features
- [ ] Links all working

---

## Post-Submission

### Once Approved

1. **Update support thread:**
   - Post: "Now available in Community Applications!"
   - Include installation instructions
   - Thank community for feedback

2. **Monitor for issues:**
   - Check GitHub issues daily
   - Respond to forum posts
   - Address bug reports promptly

3. **Maintenance:**
   - Keep Docker images updated
   - Update XML template when needed
   - Keep documentation current
   - Respond to user questions

### Updating Template

When you need to update the template:

1. **Update your repository:**
   ```bash
   # Update the-logbook.xml in your repo
   git add unraid/the-logbook.xml
   git commit -m "Update template: [describe changes]"
   git push
   ```

2. **Submit PR to AppFeed:**
   ```bash
   cd AppFeed
   git checkout main
   git pull upstream main
   cp /path/to/updated/the-logbook.xml templates/thegspiro/
   git add templates/thegspiro/the-logbook.xml
   git commit -m "Update The Logbook template: [describe changes]"
   git push origin main
   # Create PR
   ```

3. **Update forum thread:**
   - Post about changes
   - Note any migration steps

---

## Best Practices

### Naming Conventions

- **Container Name:** Use PascalCase: `TheLogbook` (not `the-logbook` or `thelogbook`)
- **XML File:** Use lowercase with hyphens: `the-logbook.xml`
- **Category:** Follow Unraid standards: `Productivity: Status:Stable`

### Port Selection

**Avoid these common ports:**
- 80, 443 (HTTP/HTTPS - Unraid WebUI)
- 3000 (Common app port)
- 3306 (MySQL)
- 5432 (PostgreSQL)
- 6379 (Redis)
- 8080, 8081, 8443 (Common alternates)
- 9000 (Portainer)

**Recommended ranges:**
- 7000-7999 (Less common)
- 10000-11000 (High ports)
- 32768-60999 (Ephemeral port range)

### Volume Mappings

**Standard Unraid paths:**
```
/mnt/user/appdata/APP-NAME/        # Application data
/mnt/user/appdata/APP-NAME/config  # Configuration
/mnt/user/appdata/APP-NAME/logs    # Logs
/mnt/user/backups/APP-NAME/        # Backups
```

**Cache drive considerations:**
- AppData typically on cache
- Uploads may be on cache or array
- Backups typically on array

### User/Group IDs

**Unraid defaults:**
```
PUID=99    # nobody user
PGID=100   # users group
```

Always include these for proper file permissions.

---

## Resources

### Official Documentation

- [Unraid Docker Documentation](https://wiki.unraid.net/Docker_Management)
- [Community Applications Wiki](https://forums.unraid.net/topic/38582-plug-in-community-applications/)
- [Docker Template Guidelines](https://forums.unraid.net/topic/57181-docker-faq/)

### Community Resources

- [Unraid Forums](https://forums.unraid.net/)
- [Unraid Discord](https://discord.gg/unraid)
- [r/unraid](https://reddit.com/r/unraid)

### Template Examples

Good examples to reference:
- **LinuxServer.io containers** - Well-documented, follow best practices
- **Hotio containers** - Clean templates
- **binhex containers** - Comprehensive documentation

### Tools

- **XML Validator:** https://www.xmlvalidation.com/
- **Icon Generator:** https://realfavicongenerator.net/
- **Screenshot Tools:** ShareX (Windows), Flameshot (Linux)

---

## Support

### Questions?

- **Community Apps Issues:** https://github.com/Squidly271/AppFeed/issues
- **Unraid Forums:** https://forums.unraid.net/
- **Our Repository:** https://github.com/thegspiro/the-logbook/issues

### Need Help?

1. Check existing Community Apps for examples
2. Read Unraid Docker documentation
3. Ask in Unraid Forums Docker section
4. Join Unraid Discord

---

## Changelog Template

Keep a changelog for your template updates:

```markdown
## [1.0.0] - 2026-01-20
### Added
- Initial Community Applications release
- Docker template with all core features
- Comprehensive documentation
- Automated backup support

### Changed
- N/A (initial release)

### Fixed
- N/A (initial release)
```

---

## Final Notes

- **Be responsive:** Answer user questions promptly
- **Keep updated:** Maintain template and documentation
- **Be helpful:** Users range from beginners to experts
- **Follow conventions:** Match Unraid community standards
- **Test thoroughly:** Broken templates reflect poorly

**Good luck with your submission!** The Unraid community is welcoming and helpful. 🚀
