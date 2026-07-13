# Publishing Pesaplug so it shows up on Google

Follow these once. After this, searching your site name can find it (Google
crawling still takes a few days to a few weeks).

## Step 1 — Put the code on GitHub (free)
1. Create a free account at https://github.com and click **New repository**.
2. Name it `pesaplug`, keep it Public, click **Create**.
3. On this PC, from the project folder, run:
   ```powershell
   cd C:\Users\lilkev\Pesaplug
   git init
   git add .
   git commit -m "Pesaplug"
   git branch -M main
   git remote add origin https://github.com/<your-username>/pesaplug.git
   git push -u origin main
   ```
   (`.env`, the database and `node_modules` are ignored, so no secrets are uploaded.)

## Step 2 — Deploy free on Render (24/7 public URL)
1. Sign up at https://render.com with your GitHub account.
2. Click **New +  ->  Blueprint**, pick your `pesaplug` repo. Render reads
   `render.yaml` automatically.
3. When prompted, set the secret env values:
   - `ADMIN_USER` = admin
   - `ADMIN_PASS` = (a strong password)
   - M-Pesa keys (optional now, add later)
4. Click **Apply**. In ~2 minutes you get a permanent URL like
   **https://pesaplug.onrender.com**.

> Optional custom domain: buy `pesaplug.com` / `pesaplug.co.ke`, then in Render
> **Settings -> Custom Domains** add it and follow the DNS instructions.

## Step 3 — Point the SEO tags at your live URL
Edit these files and replace `https://pesaplug.loca.lt` with your real URL
(`https://pesaplug.onrender.com` or your domain):
- `public/index.html` (the `canonical` link and `og:url`)
- `public/robots.txt`
- `public/sitemap.xml`
Commit & push again so Render redeploys.

## Step 4 — Tell Google it exists (Search Console)
1. Go to https://search.google.com/search-console and sign in with your Google account.
2. Click **Add property -> URL prefix**, paste your live URL.
3. **Verify ownership**: easiest is the **HTML file** method — download the
   `googleXXXX.html` file Google gives you, put it in the `public/` folder,
   push, then click Verify. (Or use the DNS method if you own the domain.)
4. In the left menu open **Sitemaps**, submit `sitemap.xml`.
5. Open **URL Inspection**, paste your homepage URL, click **Request indexing**.

## Step 5 — Wait
Google typically indexes a new, verified site within a few days to a couple of
weeks. After that it can appear when people search your site name. Ranking on
page 1 for a common word takes ongoing SEO (backlinks, content, traffic).

---

### Reality check
- Google indexing **cannot be forced to happen instantly** and **cannot be done
  from localhost or the temporary loca.lt tunnel**.
- Steps 1, 2, and 4 need **your** GitHub/Render/Google logins — they can't be
  automated for you.
- Everything else (SEO tags, sitemap, robots.txt, favicon, deploy config) is
  already done in this project.
