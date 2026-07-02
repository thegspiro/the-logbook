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
- **PWA shortcuts** — long-press the app icon to see quick shortcuts to Dashboard, Events, and Scheduling (supported on Android and some desktop platforms)

### Automatic Updates

The app uses an **autoUpdate** service worker strategy:

1. Each time you open the app, it checks for updates in the background
2. If a new version is available, it downloads silently
3. The update is applied the next time you close and reopen the app
4. You do not need to take any action — updates happen automatically

In addition, the app includes a **proactive version detection** system:

1. A build timestamp is embedded in the app at build time
2. The `useAppUpdate` hook periodically checks if a newer version has been deployed
3. If a new version is detected, an **Update Available** notification bar appears at the top of the screen
4. Click the notification to refresh and load the new version

> **Hint:** If you don't see the update notification and suspect you're on an old version, you can always force a refresh with `Ctrl+Shift+R` (desktop) or by closing and reopening the app (mobile).

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

### Member ID Scanning (Inventory Checkout)

1. Navigate to **Inventory > Members** on your phone
2. Tap the **Scan Member ID** button in the toolbar
3. Your phone's camera activates
4. Point at the member's QR code or barcode ID card
5. The member is instantly selected and their inventory loads — from here you can assign or return items

This is especially useful at equipment distribution events where you need to process many members quickly.

### Barcode Scanning (Inventory)

1. Navigate to **Inventory** on your phone (or desktop)
2. Tap the **Scan** button
3. Your device camera activates as a barcode reader
4. Point at the equipment barcode or QR code
5. The item details load immediately — from here you can check out, return, or view details

Camera scanning works on **all modern browsers** — Chrome, Edge, Firefox, and Safari. On Chrome/Edge, the scanner uses the native BarcodeDetector API for fastest performance. On Firefox and Safari, it falls back to the html5-qrcode library automatically.

On **desktop computers** with only a front-facing webcam, the scanner automatically falls back from the rear camera to the front camera. Hold the barcode or QR code in front of your webcam.

> **Screenshot needed:**
> _[Screenshot of the InventoryScanModal on a desktop browser showing the webcam feed with a barcode being scanned, the live search dropdown showing matching items, and the batch action buttons at the bottom]_

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
| Member ID scan not finding member | Verify the member has a `membership_number` assigned and the ID card was generated by The Logbook. Fall back to name search if scanning fails. |
| Barcode scanner not activating | Your browser needs camera permission. Go to your phone's Settings > Privacy > Camera and ensure the browser (or the PWA) has camera access. On desktop, verify your webcam is not in use by another app. |
| Scanner not working on Firefox/Safari | The scanner automatically falls back to the html5-qrcode library when the native BarcodeDetector API is unavailable. Ensure camera permissions are granted. |
| Desktop scan shows rear camera error then recovers | This is expected — the scanner tries the rear camera first, then falls back to the front-facing webcam. The brief error is normal on desktop. |
| Login session expires too quickly on mobile | Session timeout is configured by your department administrator. Ask your IT Manager to review the session duration in Settings > Security. |
| Notifications not appearing | The Logbook uses email and in-app notifications, not native push notifications. Check your notification preferences in My Account > Notifications and verify your email address. |
| Page not loading — "Network error" | The app requires an internet connection for all data operations. Check your Wi-Fi or cellular signal. Try refreshing the page. |
| Form submission failed | Check your connection. The app does not queue submissions — if the network is unavailable at the moment you tap Submit, the submission fails. Wait for connectivity and try again. |
| App icon disappeared from home screen | Some devices remove PWA icons after system updates or storage cleanups. Reinstall following the steps above. |
| Dark mode not applying in PWA | Dark mode follows the app's theme setting (My Account > Appearance), not the device's system setting. Toggle it from within the app. |
| "Update Available" notification not appearing | The version detection checks periodically. If you suspect you're on an old version, force refresh with Ctrl+Shift+R or close and reopen the app. |
| Layout looks wrong on mobile | Mobile responsiveness has been significantly improved (major update 2026-03-22). Clear your browser cache to load the latest styles. Use landscape orientation for complex tables. |
| Login page shows "Too many attempts" | Rate limiting is active. Wait for the countdown timer to expire before trying again. |

---

## Mobile Responsiveness Updates (2026-03-22)

A comprehensive mobile responsiveness pass was applied across the entire application. The following areas received significant improvements:

### Dashboard

The main dashboard now adapts to phone and tablet screens:
- Stacked card layout on small screens (single column)
- Collapsible sections for shift, event, and notification widgets
- Touch-friendly buttons and controls sized for finger taps
- Notification cards include clear/dismiss buttons directly on the dashboard

> **Screenshot needed:**
> _[Screenshot of the Dashboard on a mobile phone (portrait) showing stacked widget cards — "My Upcoming Shifts", "Upcoming Events", and "Notifications" — with touch-friendly buttons and a compact layout]_

### Inventory Module

All inventory pages received responsive design improvements:
- **Items list**: Card layout instead of table rows on mobile
- **Admin hub**: Grouped card sections stack vertically on narrow screens
- **Member equipment**: Collapsible member rows with equipment counts
- **Floating Action Button (FAB)**: Quick-access button for common actions on mobile
  - Non-admin users see "Assign Items" action
  - Admin users see additional actions (Add Item, Scan Barcode, Import CSV)

> **Screenshot needed:**
> _[Screenshot of the Inventory Items List on a mobile phone showing item cards (instead of table rows) with name, category badge, condition indicator, and status. Show the floating action button in the bottom-right corner]_

> **Screenshot needed:**
> _[Screenshot of the Inventory Admin Hub on a mobile phone showing grouped card sections stacked vertically with prominent navigation cards for Items, Pool, Categories, Kits, and Variant Groups]_

### Other Pages

- **Scheduling**: Calendar and shift views optimized for mobile touch interaction
- **Events**: Event cards and RSVP buttons sized for touch
- **Members**: Directory uses card layout on mobile
- **Settings**: All settings pages use responsive layouts

### Desktop Camera Scanning

Camera scanning (QR codes, barcodes, member IDs) now works on desktop browsers in addition to mobile:
- Automatic fallback to user-facing camera when no environment-facing camera is available
- Shared scanner infrastructure across all scanning features (inventory, member ID, event check-in)
- Works in Chrome, Edge, Firefox, and Safari

> **Screenshot needed:**
> _[Screenshot of the MemberIdScannerModal on a desktop browser showing the webcam feed in the scanner viewport, with a QR code being detected and the member's name appearing in the result area below]_

> **Edge case:** Desktop browsers require explicit camera permission. If the user denies camera access, the scanner shows a clear error message and the user can fall back to manual text entry.

---

## Camera Scanning Improvements (2026-03-24)

### Camera Error Handling

Camera scanning across the app now provides **specific error messages** instead of generic failures:

| Error | Message |
|-------|---------|
| Camera permission denied | "Camera permission denied. Please allow camera access in your browser settings." |
| No camera available | "No camera detected on this device." |
| Camera in use by another app | "Camera is in use by another application." |

Error messages **stay visible** until you dismiss them (no auto-dismiss), giving you time to read and act on the message.

> **Screenshot needed:**
> _[Screenshot of the MemberScanPage on a mobile device showing a camera error banner: "Camera permission denied. Please allow camera access in your browser settings." with a "Try Again" button and manual entry field below]_

### Inventory Scan Modal

The `InventoryScanModal` now uses `getErrorMessage()` for consistent, specific error display. On desktop browsers where the camera fails, the manual barcode/serial number input field is always available as a fallback.

> **Edge case:** On iOS Safari, camera access requires the page to be served over HTTPS. If your department uses HTTP for local network access, camera scanning will not work — use the manual entry fallback.

### Notification Badges on Mobile

The notification unread count badge is now visible on both mobile and desktop:

- **Top navigation**: Bell icon with red badge count
- **Side navigation**: Notifications link with badge count
- **Smart polling**: Polling pauses when the app/tab is in the background, preserving battery

> **Screenshot needed:**
> _[Screenshot of the mobile top navigation bar showing the hamburger menu, page title, and bell icon with a red "3" badge]_

---

## Realistic Example: Mobile Workflow — Event Check-In, Equipment Scan & Offline Queue

Follow **FF Sarah Chen** using the PWA on her phone during a busy training day.

### Part 1: Event QR Check-In (Morning)

Sarah arrives at the station for a training event. She pulls out her phone and opens The Logbook from the home screen icon (she installed the PWA last month). She navigates to **Events** and sees today's event at the top: "Q2 Hazmat Refresher."

Sarah taps the event to open the detail page, then taps the **Check In** button. Her phone's camera opens in the barcode scanner view. She points it at the QR code posted on the training room door — the scanner reads it instantly and displays a confirmation: "Checked in at 08:02 AM."

> **Edge case:** The QR code printout at Door B is water-damaged and unreadable. Sarah taps **Manual Check-In** below the scanner. She enters her membership number (OFD-0047) and taps Submit. The system confirms: "Checked in at 08:04 AM — manual entry."

> **[SCREENSHOT NEEDED]:** _Phone camera view showing the QR scanner overlay pointed at a QR code on a door, with the event name "Q2 Hazmat Refresher" displayed at the top of the scanner screen_

### Part 2: Equipment Barcode Scan (Mid-Morning)

During a break between training modules, Sarah needs to check out a portable gas monitor from the equipment room. She opens **Inventory** and taps the **Scan** button in the toolbar. Her camera activates in barcode scanning mode.

She points the camera at the barcode label on the gas monitor. The scanner reads it and the item detail card loads: **MSA Altair 5X**, serial number **INV-000234**, condition **Good**, status **Available**.

Sarah taps **Check Out**, selects herself as the borrower (her name is pre-filled since she is logged in), sets the expected return date to today, and confirms. The item status changes to "Checked Out" with her name shown as the current holder.

> **Edge case:** The barcode on a second gas monitor is partially obscured by a sticker. The camera scan fails after a few seconds. Sarah taps the manual entry field below the scanner, types `INV-000234` in the search box, and the item is found immediately.

> **[SCREENSHOT NEEDED]:** _Inventory item detail card on mobile showing the MSA Altair 5X with serial number, condition badge, and the "Check Out" button at the bottom of the card_

### Part 3: Offline Training Submission (Afternoon — No Signal)

The morning Hazmat Refresher ends at noon. Sarah drives to a remote training site in a rural area for an afternoon practical exercise. Cell coverage drops to zero.

After the practical, Sarah opens **Training > Submit Training** and fills out the form: course name "Hazmat Refresher," duration 4 hours, date today, and selects "Completed" status. She taps **Submit**.

The app detects no network connectivity and shows a toast notification: "Queued for sync — your submission will be sent when connectivity is restored." The submission is stored in the browser's IndexedDB offline queue.

While still offline, Sarah also navigates to **Events** and RSVPs "Going" to next week's event, "Q3 Ladder Operations Drill." That RSVP is also queued with a similar toast message.

> **Edge case:** Sarah force-closes the app and reopens it 30 minutes later. She navigates to the sync queue indicator and sees both items still listed — queued items are persisted in IndexedDB, not held in memory, so they survive app restarts.

### Part 4: Back Online (Evening)

Sarah drives back toward town. As her phone regains cell signal, the app detects connectivity in the background. The offline queue begins syncing automatically:

1. **Training submission** — synced successfully. The record enters **Pending Review** status, waiting for an officer to approve it.
2. **Event RSVP** — synced successfully. Sarah's RSVP to "Q3 Ladder Operations Drill" is confirmed as "Going."

A notification appears: "2 queued items synced successfully." Sarah taps it to verify — her training submission shows "Pending Review" in Training, and her RSVP shows "Going" on the event page.

> **Edge case:** If one of the queued items had failed during sync (for example, if someone else had already submitted an identical training record creating a duplicate conflict), the sync would show an error toast with the specific failure reason: "Training submission failed: A record for this course on this date already exists." The failed item remains in the queue with an error badge. Sarah can tap it to edit and retry, or dismiss it if the duplicate was submitted by someone else on her behalf.

> **[SCREENSHOT NEEDED]:** _Sync status notification on mobile showing "2 queued items synced successfully" with green checkmarks next to "Training submission" and "Event RSVP," displayed as a toast or notification card_

---

**Previous:** [Skills Testing & Psychomotor Evaluations](./09-skills-testing.md) | **Next:** Return to [Training Guide Index](./README.md)
