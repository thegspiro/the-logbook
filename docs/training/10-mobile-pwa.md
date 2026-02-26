# Mobile & PWA Usage

The Logbook is a Progressive Web App (PWA), which means it works in any modern web browser but can also be installed to your phone or tablet's home screen for a native app-like experience. No app store download is required.

This guide covers installing the app, understanding offline behavior, using mobile-friendly features, and troubleshooting common mobile issues.

---

## Table of Contents

1. [What Is a PWA?](#what-is-a-pwa)
2. [Installing on iPhone / iPad (Safari)](#installing-on-iphone--ipad-safari)
3. [Installing on Android (Chrome)](#installing-on-android-chrome)
4. [Installing on Desktop (Chrome / Edge)](#installing-on-desktop-chrome--edge)
5. [The Installed App Experience](#the-installed-app-experience)
6. [Offline Behavior and Limitations](#offline-behavior-and-limitations)
7. [Push Notifications on Mobile](#push-notifications-on-mobile)
8. [Mobile-Optimized Features](#mobile-optimized-features)
9. [Tips for Mobile Use](#tips-for-mobile-use)
10. [Troubleshooting](#troubleshooting)

---

## What Is a PWA?

A Progressive Web App is a website that can be installed on your device and behaves like a native app:

| Feature | Browser | Installed PWA |
|---------|---------|---------------|
| Access from home screen | No (open browser, type URL) | Yes (tap icon) |
| Full-screen experience | No (browser toolbar visible) | Yes (standalone, no browser UI) |
| Works without internet | Limited | Cached pages load, but data requires connection |
| Automatic updates | Yes | Yes (updates silently in background) |
| App store required | No | No |

The Logbook uses the **autoUpdate** strategy — when a new version is deployed, it is automatically downloaded in the background and applied the next time you open the app.

---

## Installing on iPhone / iPad (Safari)

iOS requires using **Safari** to install PWAs. Other browsers (Chrome, Firefox) on iOS cannot install PWAs to the home screen.

1. Open **Safari** and navigate to your department's Logbook URL.
2. Log in to verify the site loads correctly.
3. Tap the **Share** button (the square with an upward arrow, at the bottom of the screen on iPhone or top on iPad).
4. Scroll down in the share sheet and tap **Add to Home Screen**.
5. The name will default to "The Logbook" — you can change it if you wish.
6. Tap **Add** in the upper right corner.

> **Screenshot placeholder:**
> _[Screenshot of the Safari share sheet on iPhone showing the "Add to Home Screen" option highlighted, with the Logbook URL in the address bar above]_

The Logbook icon now appears on your home screen. Tapping it opens the app in standalone mode (no Safari toolbar).

> **Hint:** If you don't see "Add to Home Screen" in the share sheet, make sure you are using Safari (not Chrome or another browser) and that you are on the actual Logbook page (not a redirect or login page from a different domain).

---

## Installing on Android (Chrome)

1. Open **Chrome** and navigate to your department's Logbook URL.
2. Log in to verify the site loads correctly.
3. Chrome will show a banner at the bottom: **"Add The Logbook to Home screen"** — tap **Install**.
4. If the banner does not appear, tap the **three-dot menu** (top right) and select **Install app** or **Add to Home screen**.
5. Confirm by tapping **Install**.

> **Screenshot placeholder:**
> _[Screenshot of Chrome on Android showing the install banner at the bottom of the screen ("Add The Logbook to Home screen") with an Install button]_

The Logbook icon appears on your home screen and in your app drawer. It opens in standalone mode.

> **Hint:** Some Android devices also support installing from Firefox or Samsung Internet. The process is similar — look for "Install" or "Add to Home screen" in the browser menu.

---

## Installing on Desktop (Chrome / Edge)

1. Open **Chrome** or **Edge** and navigate to your department's Logbook URL.
2. Look for the **install icon** in the address bar (a monitor with a down arrow, or a "+" icon).
3. Click it and confirm **Install**.
4. The app opens in its own window and appears in your system's application launcher.

Alternatively, use the browser menu: **three-dot menu > Install The Logbook** (Chrome) or **Settings > Apps > Install this site as an app** (Edge).

---

## The Installed App Experience

Once installed, The Logbook runs in **standalone** mode:

- **No browser toolbar** — the app uses the full screen, with the status bar showing your department's theme color (dark red by default)
- **Own task/window** — it appears as a separate app in your task switcher, not as a browser tab
- **Persistent login** — your session persists between app launches (subject to your department's session timeout policy)
- **App icon** — the Logbook icon (or your department's logo) appears on your home screen

### Automatic Updates

The app uses an **autoUpdate** service worker strategy:

1. Each time you open the app, it checks for updates in the background
2. If a new version is available, it downloads silently
3. The update is applied the next time you close and reopen the app
4. You do not need to take any action — updates happen automatically

There is no "Update Available" prompt or manual refresh needed.

---

## Offline Behavior and Limitations

The Logbook is designed as an **online-first** application. The PWA caches the app shell (HTML, CSS, JavaScript) for fast loading, but **data operations require an internet connection**.

### What Works Offline

- **App shell loads** — the navigation, layout, and UI framework display even without a connection
- **Previously viewed pages** may show cached content (depending on what you last viewed)

### What Requires a Connection

- **All data operations** — viewing member lists, submitting forms, checking in, RSVPing, logging training, etc.
- **API calls** — the service worker is configured with a **NetworkOnly** strategy for all `/api` routes, meaning data is never served from cache

This is a deliberate design decision for data integrity and HIPAA compliance — serving stale or cached member data could lead to incorrect records or privacy issues.

### What Happens When You Lose Connection

- Actions that require the server will show an error message (typically "Network error" or "Unable to connect")
- The app does not queue actions for later — if a submission fails, you need to retry when connected
- The UI remains responsive; you just cannot load new data or submit changes

> **Hint:** If you are attending an event at a location with poor cell coverage, check in or RSVP before you arrive while you still have signal. QR code check-in also works — the scan happens on the device and the check-in is submitted when the device has connectivity.

---

## Push Notifications on Mobile

The Logbook sends notifications through email and the in-app notification system. On mobile devices:

- **Email notifications** work as configured in your notification preferences (event reminders, training expiry, schedule changes)
- **In-app notifications** appear when you open the app — a badge count shows unread notifications

### Enabling Notifications

1. Navigate to **My Account > Notifications** (or the Notifications page in the sidebar)
2. Toggle notification preferences for each category:
   - Event reminders
   - Training expiration warnings
   - Schedule changes
   - Form submission alerts
3. Choose delivery method: **Email**, **In-App**, or **Both**

> **Hint:** For time-sensitive alerts (shift changes, urgent messages), enable email delivery so you receive them even when the app is not open.

---

## Mobile-Optimized Features

Several features are specifically designed for mobile use:

### QR Code Check-In (Events & Shifts)

1. An officer displays the event's QR code on a screen or printout
2. On your phone, scan the QR code with your camera app
3. Your phone opens The Logbook's check-in page
4. Tap **Confirm Check-In**
5. Scan again when leaving to check out

This is the most common mobile interaction — members scan QR codes at events and shift changes.

### Barcode Scanning (Inventory)

1. Navigate to **Inventory** on your phone
2. Tap the **Scan** button
3. Your phone's camera activates as a barcode reader
4. Point at the equipment barcode or QR code
5. The item details load immediately — from here you can check out, return, or view details

### Form Submission

Forms are fully responsive and work well on mobile:
- Signature fields use touch input — sign with your finger
- Date/time pickers use the device's native controls
- File upload uses the device's camera or photo library
- Checkbox fields are sized for touch targets

### Event RSVP

Quick RSVP from the events list — tap **Going**, **Maybe**, or **Not Going** without opening the full event detail page.

---

## Tips for Mobile Use

1. **Install the app** — using the browser is fine, but the installed PWA gives you a better experience (full screen, home screen icon, faster launch).

2. **Use landscape mode for tables** — member directories, compliance matrices, and report tables are easier to read in landscape orientation on a phone.

3. **Use the search** — on small screens, search is faster than scrolling through long lists. The member directory, inventory, and course library all have search bars.

4. **Check in early** — if the event location has poor cell reception, check in while you still have signal. The system records the check-in time when the server receives it.

5. **Keep your session active** — if your department has a short session timeout, you may need to log in frequently on mobile. Consider asking your IT Manager about the timeout configuration.

6. **Clear the app cache if things look wrong** — if the app seems stuck on an old version or displays incorrectly, see the troubleshooting section below.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Add to Home Screen" not appearing (iOS) | You must use **Safari**. Chrome, Firefox, and other browsers on iOS cannot install PWAs. Also verify you are on the actual Logbook URL, not a redirect page. |
| "Add to Home Screen" not appearing (Android) | Ensure you are using Chrome. The option may be in the three-dot menu under "Install app" or "Add to Home screen." Some browsers use different wording. |
| App shows blank screen after install | Close the app completely and reopen. If it persists, uninstall from home screen, clear browser cache for the site, and reinstall. |
| App stuck on old version | The autoUpdate service worker should handle this. If it doesn't: close the app completely, wait 30 seconds, reopen. On iOS, you can also clear Safari's website data for the Logbook URL in Settings > Safari > Advanced > Website Data. |
| QR code scan not opening the app | On iOS, the camera app opens QR links in Safari, not the installed PWA. This is an iOS limitation. The check-in still works — it just opens in Safari instead. |
| Barcode scanner not activating | Your browser needs camera permission. Go to your phone's Settings > Privacy > Camera and ensure the browser (or the PWA) has camera access. |
| Login session expires too quickly on mobile | Session timeout is configured by your department administrator. Ask your IT Manager to review the session duration in Settings > Security. |
| Notifications not appearing | The Logbook uses email and in-app notifications, not native push notifications. Check your notification preferences in My Account > Notifications and verify your email address. |
| Page not loading — "Network error" | The app requires an internet connection for all data operations. Check your Wi-Fi or cellular signal. Try refreshing the page. |
| Form submission failed | Check your connection. The app does not queue submissions — if the network is unavailable at the moment you tap Submit, the submission fails. Wait for connectivity and try again. |
| App icon disappeared from home screen | Some devices remove PWA icons after system updates or storage cleanups. Reinstall following the steps above. |
| Dark mode not applying in PWA | Dark mode follows the app's theme setting (My Account > Appearance), not the device's system setting. Toggle it from within the app. |

---

**Previous:** [Skills Testing & Psychomotor Evaluations](./09-skills-testing.md) | **Next:** Return to [Training Guide Index](./README.md)
