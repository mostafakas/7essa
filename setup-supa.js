const { Client } = require('pg');

async function run() {
  const adminUrl = 'postgresql://postgres.zjuqyyltdwqrylajayxa:Mostafa2026System@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
  const client = new Client({ connectionString: adminUrl });
  
  try {
    await client.connect();
    console.log("Connected to Supabase!");

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hessa_app') THEN
          CREATE ROLE hessa_app LOGIN PASSWORD 'Mostafa2026System' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);
    console.log("App role 'hessa_app' created successfully.");

    await client.query(`GRANT USAGE ON SCHEMA public TO hessa_app;`);
    console.log("Grants applied.");

  } catch (err) {
    console.error("Error setting up database:", err);
  } finally {
    await client.end();
  }
}

run();
