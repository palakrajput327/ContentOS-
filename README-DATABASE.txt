================================================================================
CONTENTOS POSTGRESQL DATABASE GUIDE — cPanel Deployment
================================================================================

Aapke paas pehle se database hai ya naya banana hai, dono scenarios ke liye steps:

--------------------------------------------------------------------------------
SCENARIO A: Agar aapke paas pehle se chal raha database hai (Existing Database)
--------------------------------------------------------------------------------
Aapko pura database drop ya overwrite karne ki bilkul zaroorat nahi hai.
Aapke existing users, posts, accounts aur tokens bilkul safe rahenge.

Sirf nayi migrations apply karni hain:

TAREEQA 1 (Automatic & Safest — Recommended):
1. cPanel me backend deploy karne ke baad terminal / SSH open karein.
2. cPanel virtualenv activate karein:
     source /home/YOUR_CPANEL_USER/nodevenv/YOUR_API_DIR/22/bin/activate
3. Backend folder me jakar ye command run karein:
     node --env-file=.env dist-api/migrate.js
   * Ye system database me `schema_migrations` table check karega.
   * Jo migration pehle se applied hain unhe chhod dega.
   * Jo nayi migration bachi hongi, unhe safely apply kar dega.

TAREEQA 2 (Manual via phpPgAdmin):
1. phpPgAdmin me apna database open karein.
2. SQL tab me jakar check karein kaunse migrations lag chuke hain:
     SELECT name FROM schema_migrations ORDER BY name ASC;
3. Is package ke `migrations/` folder me se jo migration aapke database me nahi hai
   (jaise `030_google_auth.sql`, `031_workflow_integrity.sql`, `032_google_signup_state.sql`, `033_manual_publication_policy.sql`),
   us SQL file ka code copy karke phpPgAdmin ke SQL box me paste karein aur Run kar dein.

--------------------------------------------------------------------------------
SCENARIO B: Agar bilkul NAYA / Fresh Database bana rahe hain (Empty Database)
--------------------------------------------------------------------------------
1. cPanel me "PostgreSQL Databases Wizard" se naya database aur user create karein.
2. User ko database par ALL PRIVILEGES assign karein.
3. phpPgAdmin open karke us database ko select karein.
4. "SQL" tab me jayein, is package ki `database_full_setup.sql` file open karein,
   pura text copy karke paste karein aur Execute / Run kar dein.
   (Ya phpPgAdmin me Import tab se `database_full_setup.sql` upload kar lein).
5. Ye ek click me sare 33 tables, triggers, indexes, and initial constraints set kar dega.

--------------------------------------------------------------------------------
IMPORTANT cPanel .env CONFIGURATION:
--------------------------------------------------------------------------------
Aapke backend ke `.env` file me DATABASE_URL aisa hona chahiye:

  DATABASE_URL=postgresql://CPANELUSER_dbname:YOUR_PASSWORD@127.0.0.1:5432/CPANELUSER_dbname

* cPanel local database ke liye host `127.0.0.1` ya `localhost` use hota hai (SSL disabled hota hai).
* Cloud database (jaise Neon) ke liye SSL enabled rehta hai.
* Agar password me special characters hain (jaise @, #, $, %, :, ?), unhe URL encode karein.

Files included in this package:
- `database_full_setup.sql` : Complete unified schema setup (Fresh DB ke liye)
- `migrations/`             : All 33 individual migration files (001 to 033)
- `README-DATABASE.txt`     : This guide
================================================================================

