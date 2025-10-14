import dotenv from "dotenv";
import { Pool } from "pg";
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const run = async () => {
  await pool.query(`TRUNCATE company_values, companies, datapoints, pdf_mappings, pdf_templates RESTART IDENTITY CASCADE`);


  // 10 datapoints
  const datapoints = [
    ["company_name","Company Name"],
    ["contact_name","Contact Name"],
    ["invoice_date","Invoice Date"],
    ["amount_due","Amount Due"],
    ["due_date","Due Date"],
    ["address","Address"],
    ["city","City"],
    ["state","State"],
    ["postal_code","Postal Code"],
    ["phone","Phone"]
  ];

  for (const [key,label] of datapoints) {
    await pool.query("INSERT INTO datapoints (key,label) VALUES ($1,$2)", [key,label]);
  }

  // 10 companies with values
  for (let i=1;i<=10;i++){
    const cname = `Company ${i}`;
    const { rows } = await pool.query("INSERT INTO companies (name) VALUES ($1) RETURNING id", [cname]);
    const companyId = rows[0].id;

    const values = {
      company_name: cname,
      contact_name: `Contact ${i}`,
      invoice_date: `2025-0${(i%9)+1}-0${(i%27)+1}`,
      amount_due: (1000 + i*37).toFixed(2),
      due_date: `2025-12-${(i%27)+1}`,
      address: `${i} Main St`,
      city: "Metropolis",
      state: "CA",
      postal_code: `${(i).toString().padStart(2,'0')}01`,
      phone: `(555) 010-${(i).toString().padStart(4,'0')}`
    };

    const { rows: dpRows } = await pool.query("SELECT * FROM datapoints ORDER BY id ASC");
    for (const dp of dpRows){
      await pool.query("INSERT INTO company_values (company_id, datapoint_id, value) VALUES ($1,$2,$3)",
        [companyId, dp.id, values[dp.key] || `Value ${i}-${dp.id}`]);
    }
  }
  console.log("Seeded mock data.");
  process.exit(0);
};

run().catch(e=>{ console.error(e); process.exit(1); });
