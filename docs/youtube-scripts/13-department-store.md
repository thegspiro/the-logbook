# Script 13: The Department Store — Selling Merch Without Becoming a Payment Processor

**Video Type:** Feature Deep Dive (Medium-Form)
**Estimated Length:** 17–21 minutes
**Target Audience:** Quartermasters, secretaries, treasurers, and any member ordering from the store
**Roles Covered:** quartermaster, secretary, treasurer, member (baseline)
**Chapters:** 8 (each designed as a standalone clip)

> **Companion material:** Training guide 18 (Department Store) is the written
> version of this script. Chapter 6 overlaps Script 7 (Secretary &
> Administrative Guide) — use whichever fits the playlist.

---

## CHAPTER 1: The Problem With Selling Job Shirts (0:00 – 2:00)

### HOOK (0:00 – 0:40)

**[SCREEN: A spreadsheet titled "SHIRT ORDER FINAL v3 (USE THIS ONE).xlsx" with
inconsistent size columns, a column of names, and three cells highlighted
yellow with no legend.]**

> "Every department has this file. Somebody's selling job shirts, the sizes are
> in a spreadsheet, the money's in a Venmo feed, and matching one to the other
> is somebody's Saturday. Then a member asks 'did my payment go through?' and
> nobody's really sure."

**[TRANSITION: Wipe to the Store page]**

> "The Department Store module is for exactly this. Let me be clear about what
> it does and doesn't do first, because that's the part people get wrong."

### THE SCOPE BOUNDARY (0:40 – 2:00)

**[CALLOUT: "The Logbook never takes a payment."]**

> "The Logbook does **not** take payments. There's no card form, no checkout, no
> money moving through this application. That's deliberate — a volunteer
> department mostly can't become a card processor, and holding card data would
> drag your whole install into PCI compliance to sell forty shirts a year."

**[SCREEN: Split — left, the order list with balances; right, a phone showing
the Venmo app open with an amount prefilled.]**

> "What it does is track **what people ordered and what they owe**, and make
> settling up fast to record. The money still moves the way it always has —
> Venmo, PayPal, Cash App, Zelle, cash, a check. The store just stops it from
> getting lost."

**[TRANSITION: Setup]**

---

## CHAPTER 2: Setup — Two Switches, Not One (2:00 – 5:45)

### ENABLING THE MODULE (2:00 – 2:45)

**[SCREEN: Admin Settings → Modules, toggling "Store" on. Then the sidebar,
where "Store" appears.]**

> "First, enable the module in Admin Settings. That puts **Store** in your
> sidebar."

**[SCREEN: Store → Admin → Settings tab, showing the "Store is live for
members" toggle.]**

> "Then there's a **second** switch inside the store itself. And it's worth
> thirty seconds on why."

**[CALLOUT: "Module = does it exist. Store is live = can members shop."]**

> "The module switch decides whether the store exists at all. This one takes the
> **member-facing shop** offline while leaving your admin screens up. So you can
> close between windows, or rebuild the catalog, and still work the orders
> already placed. Members see nothing; you keep everything."

### PAYMENT METHODS (2:45 – 3:30)

**[SCREEN: The Settings tab, ticking Venmo, PayPal, Cash App, Zelle and Check.
Each tick reveals its fields.]**

**[CALLOUT: "A new store starts on cash."]**

> "Out of the box you'll find just **cash** ticked. That's on purpose — it's the
> only method that works with nothing filled in, so you can take an order on
> day one. Everything else you tick as you set it up."

> "So: tick every method you actually accept, then fill in the details. Venmo
> handle. PayPal.Me link. Cash App cashtag. Zelle email or phone. Who checks are
> payable to."

**[CALLOUT: "Ticked but empty = hidden, not broken."]**

> "Here's the rule that matters: a method that's ticked but **not filled in**
> doesn't show up for members at all. It's hidden, not shown as a dead button.
> A button that goes nowhere tells a member their money moved when it didn't —
> that's worse than no button."

**[SCREEN: Typing an invalid cashtag, hitting Save, and getting a validation
error.]**

> "And handles get checked when you save. Mistype a cashtag and you'll hear
> about it, rather than wondering next month why nobody used Cash App."

### WHAT THE STORE EMAILS (3:30 – 5:45)

**[SCREEN: Scrolling down Settings to the Notifications panel — two groups,
nine switches, each with a line of description under it.]**

> "Scroll down and there's every email this thing can send. Nine of them, all
> on to start with, each one telling you who gets it and when."

**[CALLOUT: "Two that catch people out."]**

> "Two are worth reading twice. **Status changes** also covers the cancellation
> email — turn it off and somebody whose order you cancel just never hears.
> And **payment receipts** covers refunds and waivers, not only payments,
> because all three are money moving on someone's order."

**[SCREEN: Unticking "Ordering is open", then opening a window and showing the
"email members" box still present but ineffective.]**

> "These are ceilings, not duplicates. The 'email members' box on an individual
> action can still skip one send — but it can't send something you've switched
> off here."

> "What they *say* is yours too. Payment instructions, the receipt footer, a
> window's pickup instructions, and a free-text message on each announcement.
> Your logo and colours come from your org's email branding, same as everything
> else on the platform."

**[SCREEN: Clicking Preview on "Order confirmation". A modal opens showing the
real email — logo, order table, Venmo button. Toggling to phone width.]**

**[CALLOUT: "Preview shows YOUR settings, not a mock-up."]**

> "And you don't have to guess. Every one of them has a **Preview** — that's the
> actual email, with your logo, your handle, your wording, on a sample order.
> Flip it to phone width, because that's where it'll be read."

> "This is the fastest way to catch the stuff that bites. Is my cashtag right?
> Does the Zelle handle read properly? Did I leave a method ticked I never
> filled in? A method you don't accept just isn't there."

**[CALLOUT: "Save first — it reads what's stored."]**

> "Two gotchas. It reads *saved* settings, so hit Save before you look. And you
> can preview something that's switched off — it'll tell you so at the top —
> which is the whole point, because otherwise you couldn't see what you were
> deciding about. Nothing gets sent, nothing gets recorded, nobody gets an
> email. Including you."

**[SCREEN: Clicking "Send this to me". A toast confirms. Cut to a phone showing
the arrived email, subject line "[TEST] Order ORD-2026-0042 received", with an
amber banner at the top.]**

> "Unless you ask. **Send this to me** puts it in your actual inbox — because a
> preview panel isn't Gmail, and 'does the Venmo button really open Venmo on my
> phone' is a question only a real email answers."

**[CALLOUT: "Goes to you. Only you."]**

> "It goes to *your* address. There's no box to type somebody else's in — this
> isn't a way to mail the department from the settings screen. And it arrives
> marked: bracket-TEST in the subject, a banner up top. That matters, because
> the sample says 'Order ORD-2026-0042 received', and an unmarked copy in your
> inbox is something you'll act on in three weeks."

**[SCREEN: Communications → Email Templates, scrolling to ten entries beginning
"Store —". Opening "Store — Order Placed With the Vendor" and rewriting the
first line.]**

> "And if you don't like how one of them is worded — rewrite it. They're in
> **Communications, Email Templates**, right alongside your welcome email. Ten
> of them, all starting with 'Store'."

**[CALLOUT: "Ten templates, nine switches. Cancellation gets its own words."]**

> "Ten, not nine — cancellation gets its own template even though it shares the
> status-changes switch. 'Your order's ready' and 'your order's cancelled'
> shouldn't read the same."

**[SCREEN: The variable list in the editor sidebar, then dragging
{{items_table_html}} into the body.]**

> "The bits you can't type — the item table, the pay buttons — are variables the
> store fills in. The editor lists what's available for whichever template
> you've got open."

**[CALLOUT: "Delete a variable, delete that part of the email."]**

> "Deleting a variable really deletes it: take the payment block out of the
> confirmation and nobody gets told how to pay. **Reset to default** puts the
> original back if you've painted yourself into a corner."

**[CALLOUT: "Editing the words doesn't switch the notice on."]**

> "And the one that catches everybody: **editing a template doesn't turn the
> notice on**. Reword something beautifully, nobody gets it, and it's because
> the switch back in Settings is still off. Words here, on-or-off there."

**[SCREEN: Deleting a template, then reloading the Email Templates page to show
it reappear with the default wording.]**

> "Don't delete one hoping to start over — you'll get the shipped default back,
> not your earlier draft. If you want a safe undo, set it **inactive**: the
> store goes back to its built-in wording and your edit's still sitting there."

> "Until you touch these, nothing changes — you keep getting the wording the
> store's always sent. And whichever version's live, that Preview button back in
> Settings shows you *that* one. So edit here, then go look."

**[TRANSITION: The catalog]**

---

## CHAPTER 3: The Catalog — Products, Sizes, Names (5:45 – 8:30)

### CREATING A PRODUCT (5:45 – 6:30)

**[SCREEN: Catalog tab → New item. Filling in "Department Job Shirt", $45,
taxable, max 2 per member. Status left on Draft.]**

> "Catalog tab, New item. Name, price, whether it's taxable. **Max per
> member** caps how many one person can order — useful when your budget assumed
> one each."

**[CALLOUT: "Cost is internal. Members never see it."]**

> "There's a **Cost** field too — what you pay the vendor. That's internal.
> Members never see it, but it's how you know whether you're breaking even."

> "Leave it on **Draft** while you build. Draft is invisible to members."

### OPTIONS (6:30 – 7:00)

**[SCREEN: Add option, adding S through 3XL, setting +3.00 on 2XL and 3XL.]**

> "Options — that's what the store calls them — are anything the member has to
> pick between — sizes, colours, men's
> and women's cut. Each one gets its own SKU, its own stock count, and a **price
> delta**. Plus three dollars on 2XL, because your vendor charges you plus
> three."

### PERSONALIZATION (7:00 – 8:00)

**[SCREEN: Enabling personalization — label "Name for embroidery", max 20
characters, $8.00 surcharge. Then the member view showing the text box.]**

> "For anything embroidered or engraved, turn on personalization. Set the label
> the member sees, the character limit your vendor imposes, and a surcharge if
> you charge one."

**[SCREEN: A cart with two job shirts — one "SMITH", one "GARCIA" — as separate
lines rather than one line of quantity 2.]**

**[CALLOUT: "Different names = different lines. Always."]**

> "Notice: two shirts with different names are always **separate lines**. They
> never merge into one line of quantity two — they're physically different
> items, and your vendor needs them listed separately."

### PHOTOS (8:00 – 8:30)

**[SCREEN: Uploading a job shirt photo, seeing it appear in the grid.]**

> "Upload a photo. Up to five megs, and it gets re-encoded so you're not storing
> a phone camera's full resolution. Members shop by picture — a catalog of text
> rows sells nothing."

**[TRANSITION: Windows]**

---

## CHAPTER 4: Order Windows — The Whole Point (7:30 – 10:00)

### WHAT A WINDOW IS (7:30 – 8:30)

**[SCREEN: Order Windows tab → New order window. "Fall Apparel 2026", closing
October 21, all active products, notify on open.]**

> "A window is an ordering period. You open it, members order, you close it, and
> you place **one** order with the vendor. That's the whole economic model of a
> department store — you don't buy shirts speculatively, you collect demand
> first."

**[SCREEN: The member store with two open windows, showing the switcher
between "Fall Apparel 2026" and "Class B Uniforms".]**

**[CALLOUT: "Multiple windows can run at once."]**

> "You can have more than one window open at a time. Members land on whichever
> closes soonest — because that's the deadline that matters to them — and can
> switch to the others. Apparel and Class B uniforms can run side by side
> without either one hiding the other."

### SUBSETS (8:30 – 9:15)

**[SCREEN: Creating a second window with a specific product list selected.]**

> "A window either offers your whole active catalog, or a specific list. The
> specific list is how you run a 'Class B uniforms only' window without
> archiving everything else first."

### OPENING IT (9:15 – 10:00)

**[SCREEN: Clicking Open ordering, with "Email the membership" ticked. An email
notification preview appears.]**

> "Open ordering, tick **Email the membership**, and everybody hears about it. There's a
> closing reminder too, on a schedule you set — because the orders you don't get
> are the ones from people who forgot."

**[TRANSITION: The member's side]**

---

## CHAPTER 5: The Member's Side — Ordering and Paying (10:00 – 13:30)

### ORDERING (10:00 – 11:00)

**[SCREEN: Member view at /store. Browsing, picking XL, typing "GARCIA" in the
personalization box, adding to cart. The cart shows subtotal, tax, total.]**

> "From the member's seat this is a normal shop. Pick your size, type your name
> if it's embroidered, add to cart. Pickup or shipping. Pick how you're going to
> pay."

**[SCREEN: Order confirmation showing ORD-2026-0042.]**

**[CALLOUT: "ORD-2026-0042 — keep this number."]**

> "You get an order number. **That number is the whole game** — it's what ties
> your payment to your order. Hang onto it."

### PAYING (11:00 – 12:45)

**[SCREEN: My Orders, showing an unpaid order with a row of buttons — Venmo,
Cash App — plus the Zelle handle.]**

> "My Orders shows what you owe and a button for every method your department
> set up. Tap Venmo, and Venmo opens with the amount **and your order number**
> already in the note."

**[SCREEN: Tapping the Cash App button; the amount is prefilled but the note is
empty. The order number is displayed on screen next to it.]**

> "Cash App is different — it has no note field, so the app can't carry your
> order number. The screen shows it right there for you to type. Same with
> PayPal."

**[SCREEN: The Zelle row — a handle with a copy icon, no button.]**

**[CALLOUT: "Zelle has no button. On purpose."]**

> "And Zelle has no button at all — that's not an oversight. Zelle lives inside
> your own bank's app and has no web link. So all anyone can honestly give you
> is the handle to copy. We're not going to send you to a page that can't pay
> anybody."

**[SCREEN: Switching between methods on the same order.]**

> "One more thing: you're **not locked into** whatever you picked at checkout.
> Chose Venmo, only have Cash App now? Use the Cash App button. The money just
> has to arrive."

### "I'VE SENT PAYMENT" (12:45 – 13:30)

**[SCREEN: Tapping "I've sent payment", entering a Venmo transaction reference.
The order badge changes to "Pending verification".]**

> "After you send it, tap **I've sent payment** and drop in the reference. Now —
> read that badge carefully. It says **pending verification**, not paid."

**[CALLOUT: "Reporting a payment isn't paying."]**

> "Your saying you paid is a claim, not a receipt. It puts your order in a queue
> for somebody to check the money actually landed. That's not distrust — it's
> the difference between your record and the bank's."

**[TRANSITION: The quartermaster's side]**

---

## CHAPTER 6: Working the Orders (13:30 – 16:00)

### THE TWO-STATUS MODEL (13:30 – 14:30)

**[SCREEN: Orders tab with two badge columns — fulfillment status and payment
status — visibly out of step on several rows.]**

> "Every order has **two** statuses, and they move independently. Fulfillment:
> submitted, ordered, ready for pickup, fulfilled. Payment: unpaid, pending
> verification, partly paid, paid, waived."

**[CALLOUT: "Paid but not ordered. Ready but not paid. Both normal."]**

> "Somebody can pay for a shirt you haven't ordered from the vendor yet. A shirt
> can be on the shelf ready for pickup while they still owe. Both happen
> constantly, which is exactly why these aren't one field."

### YOUR DEPARTMENT'S RULE ON UNPAID ORDERS (14:30 – 15:15)

**[SCREEN: Settings → "What happens to an unpaid order?" — three radio cards
side by side, each showing Vendor order / Pickup and who it suits.]**

> "Now — what happens to somebody who orders and doesn't pay? Departments
> genuinely disagree here, so you pick."

**[CALLOUT: "No gate / Pay before pickup / Pay before the vendor order"]**

> "**No payment gate** — their shirt gets ordered, they can collect it, you
> chase the money. **Payment before pickup** — the shirt gets ordered like
> everyone else's, but it stays on your shelf until they pay. **Payment before
> the vendor order** — they don't get one. They're held out entirely, and you
> can't even mark it ordered — the record would be claiming you told the vendor
> about a shirt you deliberately left off the sheet."

**[CALLOUT: "Pick it before you build. Change it whenever."]**

> "It's laid out as a comparison because you're picking this *before* you have
> a catalog to try it on — each card tells you what happens to the vendor order,
> what happens to pickup, and which kind of department it suits. And it's not a
> one-way door. Change it whenever your practice changes; it governs what
> happens next and never un-orders something you've already sent."

**[SCREEN: The Tally under the strictest rule, showing "Order this from the
vendor: 2 shirts" and a "Held back — unpaid (2 orders)" panel beneath it.]**

> "And notice under that last one — the held-back orders are still **shown**.
> They're not quietly dropped. You need to see who you're leaving out so you
> can go chase them before the order goes in. Take their money and they rejoin
> the totals on the spot."

**[SCREEN: Bulk-fulfilling a window; a result showing 12 updated, 2 skipped
with order numbers and balances.]**

> "Same when you hand out. Bulk-fulfil the window, the paid ones go through,
> the unpaid ones come back named with what they owe. Waiving works too — comp
> somebody a replacement and it clears the gate the same as paying."

### RECORD HOW THEY *ACTUALLY* PAID (15:15 – 15:45)

**[SCREEN: An order detail with the "Paid by" dropdown open — it reads Venmo,
being changed to Cash.]**

> "Casey picked Venmo at checkout. Then she handed you a twenty at drill. The
> **Paid by** dropdown is where you say so."

**[CALLOUT: "Wrong method = treasurer short, nobody knows why."]**

> "Leave it on Venmo and your treasurer reconciles the Venmo payout, comes up
> one payment short, and has nothing to go on. Thirty seconds here saves an
> evening later."

**[SCREEN: The Orders tab, filtering by payment method — Zelle — showing just
those orders.]**

> "And that's what makes the **method filter** work. Each app pays out
> separately, so when you're sat in front of a Zelle statement you want the
> Zelle orders and nothing else."

### RECORDING MONEY (15:45 – 16:15)

**[SCREEN: Clicking Mark paid on a row; the balance clears in place.]**

> "**Mark paid** is the one you'll use ninety percent of the time. It reads the
> balance off the order, so there's no amount to fat-finger."

> "**Record payment** takes a specific amount, for partials. **Waive** clears a
> balance without money — a replacement for a defective item, a comp. It's
> recorded as a waiver, not a payment, so your totals still tell the truth."

### BULK (15:15 – 16:00)

**[SCREEN: Selecting twelve orders, clicking "Mark selected paid", then a bulk
status change to Ready for Pickup. Twelve email previews.]**

> "Select a batch and mark them all paid, or move a whole window to ready for
> pickup in one action. When the shipment lands, that's one click and everybody
> gets an email — not forty clicks and a group text."

**[TRANSITION: PayPal]**

---

## CHAPTER 7: Letting PayPal Do It For You (16:00 – 18:00)

### THE CONNECTION (16:00 – 16:45)

**[SCREEN: Settings → Integrations → PayPal → Connect. Environment dropdown,
Client ID, Secret, Webhook ID, and the callback URL.]**

> "If your department has a PayPal **Business** account, you can skip the manual
> step entirely. Connect it under Integrations, paste the callback URL into
> PayPal as a webhook, and copy the Webhook ID back."

**[CALLOUT: "Webhook ID is required, not optional."]**

> "That Webhook ID isn't optional. Without it we can't verify a delivery
> actually came from PayPal, so we reject it. Test Connection will warn you
> rather than saying everything's fine."

### THE MATCHING RULE (16:45 – 17:30)

**[SCREEN: A payment arriving and an order flipping to Paid with no clicks.]**

> "Now PayPal tells The Logbook what it received. If the reference names exactly
> one order number **and** the amount matches that balance exactly, the order
> settles itself."

**[CALLOUT: "Exact order number + exact amount. Nothing else auto-applies."]**

> "Both conditions. Nothing else auto-applies — and that's deliberate. We
> considered matching on payer name and rejected it. Two members can easily owe
> the same amount in the same window, and putting money on the wrong member's
> order is worse than making somebody wait an afternoon."

### THE REVIEW QUEUE (17:30 – 18:00)

**[SCREEN: Store Admin → Payments, showing an unmatched payment with Apply and
Dismiss.]**

> "Everything else lands here. Short payment, no order number, order already
> square — you decide. Apply it to an order, or dismiss it if it was a donation
> or dues."

**[CALLOUT: "Nothing gets dropped."]**

> "And every payment shows up here **even when it matches nothing**. That's the
> point. The money already left the member's account — the last thing you want
> is that notification quietly disappearing while they've got an order that
> still says unpaid."

**[TRANSITION: Closing out]**

---

## CHAPTER 8: Closing the Window and Calling the Vendor (18:00 – 20:00)

### THE SUMMARY (18:00 – 19:00)

**[SCREEN: Clicking Close ordering on the window, then opening the Tally — 14
orders, 19 items, $921.00 gross, $855.00 collected, $66.00 outstanding, and a
per-size tally.]**

> "Close ordering and open the Tally. Fourteen orders, nineteen items, nine
> twenty-one gross, eight fifty-five collected, sixty-six outstanding."

**[SCREEN: Zoom on "Order this from the vendor": 3 M, 6 L, 7 XL, 2 2XL,
1 3XL, total 19.]**

> "And here's the number you actually came for: three medium, six large, seven
> XL, two 2XL, one 3XL. **That's your vendor order.** No spreadsheet, no
> counting twice."

**[SCREEN: Scroll to "Line detail" — the same nineteen shirts, one row per
embroidery name.]**

**[CALLOUT: "Two tables. Buy this / stitch that."]**

> "Underneath it, the same shirts broken out by name — that's what the vendor
> embroiders. Two tables because they answer different questions, and on a
> personalized item they never look the same. Nineteen shirts, eleven names,
> five sizes."

### TELL THE VENDOR, THEN TELL THE MEMBERS (19:00 – 19:30)

**[SCREEN: Record vendor order — Galls, PO-8842, expected 14 November, "Email
everyone who ordered" ticked.]**

> "You place the order with your vendor. Then come back and **record** it —
> who, their reference, when you expect it."

**[CALLOUT: "One action: stamped, advanced, announced."]**

> "One click does three things. It stamps the window so 'has this been ordered
> yet?' comes off the record instead of somebody's memory. It marks every
> eligible order **ordered**. And it emails everyone that it's gone in, with
> the expected date."

**[SCREEN: The result toast — "4 orders marked ordered · 1 held back,
unpaid".]**

> "Held-back orders get skipped, not advanced — they weren't on the sheet the
> vendor got. That last line tells you who to chase."

> "That email is the one members actually want. Six quiet weeks between
> 'ordering closed' and 'come get it' is six weeks of people asking you in the
> bay."

### CHASING AND FULFILLING (19:30 – 19:50)

**[SCREEN: Sorting Orders by payment status to show the two unpaid.]**

> "Sixty-six dollars outstanding — sort by payment status and there's your chase
> list. Two people. Send a reminder."

**[SCREEN: Export to CSV, opening it in a spreadsheet with names and
personalization.]**

**[SCREEN: The CSV open in a spreadsheet, with the "Held From Vendor Order"
column visible and two rows reading "yes".]**

> "One thing on the export: it keeps **every** order, including the unpaid
> ones, because it's your treasurer's record too. So if you're on the strict
> rule, sort by **Held From Vendor Order** and drop the yeses before you send
> it — otherwise you'd be mailing the vendor a sheet that undoes the rule you
> just set."

> "Export the CSV for line-level detail — names, sizes, embroidery text. That's
> the file the vendor wants."

### THE CLOSE (19:40 – 20:00)

**[SCREEN: Shirts arriving, bulk-setting to Ready for Pickup, then Fulfilled.]**

> "Shirts arrive, bulk-set to ready for pickup, everybody gets an email. Hand
> them out at drill, mark fulfilled, close the window out."

**[B-ROLL: A quartermaster handing a folded job shirt across a table at a
station.]**

> "That's the department store. It doesn't take your members' money — it just
> makes sure nobody has to remember who owes what. Written version's in Training
> Guide 18. See you in the next one."

---

## Shorts Extractable From This Script

| # | Title | Source Chapter |
|---|-------|----------------|
| 13a | Pay Your Store Order From Your Phone | Chapter 5 |
| 13b | Why There's No Zelle Button | Chapter 5 |
| 13c | "I've Sent Payment" Doesn't Mean Paid | Chapter 5 |
| 13d | Close a Window, Get Your Vendor Order | Chapter 8 |
| 13e | Let PayPal Mark Your Orders Paid | Chapter 7 |
| 13f | Paid But Not Ordered — Why Two Statuses | Chapter 6 |
| 13g | Your Department's Rule on Unpaid Orders | Chapter 6 |
| 13h | They Said Venmo and Paid Cash — Record It Right | Chapter 6 |
| 13i | Tell the Vendor, Tell the Members, One Click | Chapter 8 |
| 13j | The Nine Emails Your Store Sends | Chapter 2 |
| 13k | Preview Your Store Email Before You Send It | Chapter 2 |
| 13l | Mail Yourself a Test Before Anyone Else Gets It | Chapter 2 |
| 13m | Rewrite What Your Store Emails Say | Chapter 2 |
| 13n | Why Your Reworded Email Never Arrived | Chapter 2 |
