# Campus Canteen

Order ahead. Skip the queue.

Campus Canteen is a website for a college canteen. Students pick food on their phones and get a **token number**. They watch the order move from waiting to ready, then collect it at the counter and **pay there**. Counter staff run the kitchen from a live board. An admin looks after the menu and opens or closes the canteen.

There is no online payment. The app shows the total, but it does not record whether anyone paid.

The code is set up for one campus: sign-up is limited to emails ending in `@iist.ac.in` or `@ug.iist.ac.in`.

## Contents

- [How it works](#how-it-works)
- [Tech used](#tech-used)
- [Project layout](#project-layout)
- [Set up from scratch](#set-up-from-scratch)
- [Run on your laptop](#run-on-your-laptop)
- [Deploy](#deploy)
- [Daily keep-awake job](#daily-keep-awake-job)
- [Rules and limits](#rules-and-limits)
- [Known rough edges](#known-rough-edges)
- [License](#license)

## How it works

There are three kinds of users.

| Role | Logs in with | Can do |
| --- | --- | --- |
| Student | Campus email and a one-time code | See the menu, place orders, follow their own orders |
| Chef | Email and password | See and update orders for **one** counter only |
| Admin | Email and password | See all orders, edit the menu, open or close the canteen, use the student pages |

After login, each person is sent to their own page: students to `/`, chefs to `/kitchen`, admins to `/admin`. Opening a page you are not allowed to use sends you back to your own page.

### Student flow

1. Log in with a campus email. A code arrives by email. Type it in. You stay logged in on that phone.
2. Browse the menu. You can search, filter by Veg or Non-veg, and jump to a category.
3. Add items to the cart and tap **Place order**.
4. You get a token number. If your cart has food from both counters, you get one order and one token for each counter.
5. A "Track your orders" section shows progress: Order placed, Cooking, Ready to collect, Collected.
6. Finished orders move to "Earlier orders". A cancelled order shows the reason.

If the canteen is closed, students can read the menu but cannot order. Sold-out items cannot be added.

### Chef flow

The kitchen board has three columns: **New**, **Cooking**, **Ready for pickup**. Each ticket has one big button that moves it forward (*Start cooking*, *Mark ready*, *Collected*) and a **Cancel** button. Cancelling needs a reason, and the student sees it.

The board can play a beep when a new order arrives. The browser needs one tap on **Turn sound on** first. A badge shows whether the board is live. If it has not updated for about 25 seconds, it turns red.

### Admin flow

- Open or close the canteen (closing asks for confirmation).
- Add, edit, and search menu items.
- Switch an item between available and sold out.
- Remove an item. It is hidden from students but kept in past orders. Removed items can be restored.

### Order life cycle

```
Pending -> Cooking -> Ready -> Completed
```

An order can be **Cancelled** from Pending, Cooking, or Ready, but only with a reason. Completed and Cancelled orders cannot change again.

Token numbers start at 1 each day (counted in Indian time) and go up by one for every new order. The numbers are shared by all counters.

## Tech used

- **Website:** Next.js 16, React 19, Tailwind CSS 4, TypeScript. It is built as plain static files (`output: "export"`).
- **Database and login:** Supabase (Postgres, email login, live updates).
- **Hosting:** GitHub Pages, deployed by GitHub Actions.

There is no custom server. The website talks straight to Supabase using the project URL and the public (anon) key. The data is protected by row-level security rules inside the database, not by hiding the key.

## Project layout

```
.github/workflows/
  deploy.yml          Builds the site and publishes it to GitHub Pages
  keep-alive.yml      Calls the database once a day so it stays awake
code/
  supabase/
    setup.sql         The whole database in one file
  client/
    app/
      page.tsx        Student home: menu, cart, order tracking
      login/          Login screen (Student and Canteen counter tabs)
      kitchen/        Chef board
      admin/          Admin screen
      lib/
        core.ts       Names, types, campus email check, Supabase connection
        auth.tsx      Login state, user role, page guards
        useLive.ts    Keeps a page's data fresh (polling plus live updates)
        ui.tsx        Shared pieces: buttons, token card, icons
      globals.css     Styling
LICENSE
```

## Set up from scratch

1. **Create a Supabase project.**
2. **Run the database file.** Open the Supabase SQL editor and run `code/supabase/setup.sql` once, from top to bottom, on an empty project. It creates the tables, the access rules, the functions, the staff allow-list, two counters (**Veg Counter** and **Non-Veg Counter**), and a starting menu of 91 items.
3. **Set up email login.** The login screen asks for a typed code, not a link. Check that the Supabase email template includes the one-time code. The template is not part of this repo.
4. **Create staff accounts.** Every new account starts as a student, and no screen in the app changes that. For each chef or admin:
   - Add their email (lowercase) to the `allowed_staff_emails` table.
   - Create the user in Supabase with a password.
   - In the `profiles` table, set `role` to `chef` or `admin`.
   - For a chef, also set `counter` to the exact counter name, for example `Veg Counter`. If the name is wrong or empty, that chef sees no tickets (the kitchen page shows a warning).
5. **Deploy the site** (see [Deploy](#deploy)).

## Run on your laptop

You need Node.js 20.

```bash
cd code/client
npm install
```

Create a file named `.env.local` in `code/client`:

```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Then start it:

```bash
npm run dev
```

If the two values are missing, the site shows a "not configured" message.

## Deploy

The site is published to GitHub Pages by `.github/workflows/deploy.yml`.

1. In the GitHub repo, go to **Settings > Secrets and variables > Actions > Variables** and add two repository variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
2. In **Settings > Pages**, set the source to **GitHub Actions**.
3. Push to `main`.

The job runs when a push to `main` changes anything in `code/client` or the deploy file. You can also start it by hand from the Actions tab. If either variable is missing, the job stops with a clear error. The site is served under the repository name (for example `/your-repo-name/`).

Changes to `code/supabase/setup.sql` do not trigger a deploy. Apply database changes in the Supabase SQL editor.

## Daily keep-awake job

`.github/workflows/keep-alive.yml` runs every day at 02:30 UTC. It calls a small `ping()` function in the database. This is most likely there to stop a free Supabase project from pausing after a quiet spell. It uses the same two repository variables as the deploy job.

## Rules and limits

**Who can see and change what** (enforced in the database):

- Students can read the menu and only their own orders.
- A chef can read and change only the orders of their own counter.
- An admin can read everything and change the menu and the open/closed setting.
- The website cannot write to orders directly. Orders are created only by the `place_order` function, and status changes go only through `set_order_status`. Both check who is asking.
- A person who is not logged in can do nothing except call `ping()`.
- Sign-up is refused for any email that is not a campus email or on the staff allow-list.

**Order limits:**

- Up to 20 of the same item.
- Up to 40 items in one order.
- Up to 6 active orders (Pending, Cooking, or Ready) per student at a time.

**Safe retries:** each time a student taps Place order, the site makes a random request ID for that cart. If the same cart is sent again after a bad connection, the database returns the orders it already made instead of making new ones, so nobody gets two tokens.

**How often pages refresh:** the student menu about once a minute, the open/closed state every 15 seconds, a student's orders every 10 seconds, and the kitchen board every 8 seconds plus live updates. Pages also refresh when the phone wakes up or the internet comes back.

## Known rough edges

- `setup.sql` keeps its history. The `place_order` function is written three times, and the sign-up and status functions more than once. The last copy of each wins, so the result is correct, but run the file whole and in order.
- The `roll_no` column on `profiles` is left over from an earlier version. It is optional now and not used.
- Making a chef or admin needs direct database edits (see step 4 above).
- The `counters` table is not part of the live feed, so the kitchen page notices a counter change on its once-a-minute refresh.
- Payment is not tracked.

## License

MIT. See [LICENSE](LICENSE).
