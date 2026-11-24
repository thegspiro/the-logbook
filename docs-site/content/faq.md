# Frequently asked questions

Short answers to the questions members and administrators ask most. Each one
links to the guide section with the full detail.

## Signing in

### My password stopped working, but I know it is right

Your account is probably locked. After 5 wrong tries in a row, an account is
locked for 15 minutes (your department can change both numbers), and while it
is locked the sign-in page still says only _"Incorrect username or password"_.
Wait 15 minutes, use **Forgot Password?**, or ask your IT manager to reset your
password, which also unlocks the account. See
[Sign-In and Session Problems](../../docs/training/00-getting-started.md#sign-in-and-session-problems).

### How do I reset my password?

Select **Forgot Password?** on the sign-in page. The email you get has a reset
link that works for 30 minutes. If the page says **No Reset Link Was Sent**,
your department signs in through Google or Microsoft (reset the password with
them), or it has turned off reset emails (ask an administrator). See
[Getting Help](../../docs/training/00-getting-started.md#getting-help).

### I asked for a password reset twice and only got one email

Only the first request sends an email. For the next 30 minutes, further
requests show the same "check your email" message but send nothing. Use the
link in the first email.

### Why was I signed out while I was working?

The Logbook signs you out after a period of inactivity: 15 minutes, unless your
department set a different time. A warning appears 60 seconds before; move the
mouse or press a key to stay signed in. See
[Sign-In and Session Problems](../../docs/training/00-getting-started.md#sign-in-and-session-problems).

### My authenticator code is refused even though it looks right

Turn on automatic (network) time on your phone, since the codes depend on an
accurate clock, then enter a fresh code promptly. If you have lost your
authenticator and your recovery codes, an administrator can reset two-factor
sign-in from your row in Members. See
[Two-Factor Authentication](../../docs/TROUBLESHOOTING.md#two-factor-authentication-mfa).

## Using the app

### Can I put The Logbook on my phone's home screen?

Yes. On an iPhone or iPad, open your department's Logbook address in Safari,
select **Share**, then **Add to Home Screen**. On Android, open it in Chrome and
select **Install** (or **Install app** from the three-dot menu). See
[Mobile & PWA Usage](../../docs/training/10-mobile-pwa.md).

### Something is missing from my menu

Your department may not use that part of the app, or your position may not
include it. Ask your administrator.

### A page says "Access Denied"

Your position does not include that page. Select **Return to Dashboard**, and
ask your officer or IT manager if you think you need it. Trying again will not
help.

### How do I log training I did somewhere else?

Select **Training > Submit Training**, fill in the course, date and length,
and attach the certificate (PDF, JPG or PNG, up to 10 MB). See
[Submitting Training Records](../../docs/training/02-training.md#submitting-training-records).

### How do I request time off or swap a shift?

Both start from **My Shifts**. Select **Request Time Off** for time off, or
**Swap** on an upcoming shift to ask for it to be covered. See
[Time-Off Requests](../../docs/training/03-scheduling.md#time-off-requests) and
[Shift Swap Requests](../../docs/training/03-scheduling.md#shift-swap-requests).

### How do I check in to an event?

Scan the QR code shown at the door when you arrive. See
[QR Code Check-In](../../docs/training/04-events-meetings.md#qr-code-check-in).

### What does a word in the app mean?

The [Glossary](../../docs/training/GLOSSARY.md) explains the words The Logbook
uses and the abbreviations in these guides.

## Running a server

### How do I install The Logbook?

Start with [Installation](../../wiki/Installation.md). Platform guides cover
[Unraid](../../wiki/Deployment-Unraid.md),
[Docker](../../wiki/Deployment-Docker.md) and
[AWS](../../docs/deployment/aws.md); the Reference tab has the other platforms.

### How do I upgrade safely?

Read [Upgrading](../../docs/UPGRADING.md) before every upgrade. It lists the
changes that need a step from you, including the ones that cannot be undone
without a database backup taken first.

### Links in emails point to localhost or will not open

The server's public address is not set. See
[Links in Emails Point to localhost or Will Not Open](../../docs/TROUBLESHOOTING.md#links-in-emails-point-to-localhost-or-will-not-open).

### Where do I find a fix for an error message?

Search for the message with the search box at the top of this page, or browse
the [troubleshooting guide](../../docs/TROUBLESHOOTING.md).
