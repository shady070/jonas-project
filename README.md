# 🧩 PDF Form Automation (Vue + Node + PostgreSQL)

This project provides two main modules:
1. **PDF Form Filler** — upload a PDF, map datapoints visually, and generate filled PDFs using mock company data.  
2. **Word Template Generator** — planned for next phase (document generation from templates).

---

## 🚀 Quick Start (Local Setup)

### 1️⃣ Requirements
- Docker Desktop installed and running  
- Node.js (v18+)  
- Git  

---

### 2️⃣ Clone the Project
```bash
git clone https://github.com/<your_repo_name>.git
cd vue-pdf-form-demo
3️⃣ Start the Containers
docker compose up -d --build
This starts:

PostgreSQL on port 5432

Backend (Express) on port 8080

Then seed mock data:

docker compose exec backend node src/seed.js
✅ You should see:

Seeded mock data.
To confirm backend is running:

curl http://localhost:8080/api/health
Response should be:

{ "ok": true }
🖥 Frontend Setup (Vue)
1️⃣ Install dependencies
cd frontend
npm install
2️⃣ Configure API
Create a .env file inside /frontend and add:

VITE_API_BASE=http://localhost:8080
3️⃣ Run the app
npm run dev
Open http://localhost:5173 in your browser.

🧠 How It Works
1️⃣ Upload a PDF Template
Upload a PDF (e.g. test-template-blank.pdf).

The system reads and stores the file (with page count).

2️⃣ Map Datapoints
Select datapoints such as company_name, invoice_date, etc.

Drag and drop them onto the PDF preview.

Click “Save Mapping”.

3️⃣ Generate PDFs
Select one or multiple companies.

Click “Generate” to create filled PDFs.

The system returns a ZIP file with all generated PDFs.

🧩 Backend Overview
Tech Stack:

Node.js

Express

PostgreSQL

PDF-Lib

Multer

Archiver

Main API Endpoints
Method	Path	Description
GET	/api/health	Health check
GET	/api/companies	List all companies
GET	/api/datapoints	List all datapoints
GET	/api/company/:id/values	Company data
POST	/api/templates/upload	Upload a PDF
GET	/api/templates	List templates
POST	/api/templates/:id/mappings	Save mappings
GET	/api/templates/:id/mappings	Fetch mappings
POST	/api/templates/:id/generate	Generate filled PDFs (ZIP)

🧰 Useful Commands
Restart backend:

docker compose restart backend
Watch backend logs:

docker compose logs -f backend
Drop + reseed data:

docker compose exec backend node src/seed.js
Stop everything:

docker compose down
🌐 Sharing for Client Testing
If your client wants to test without setting up locally:

Option 1: LocalTunnel
npx localtunnel --port 8080
Option 2: ngrok (Recommended)
bash
Copy code
ngrok config add-authtoken <your_token>
ngrok http 8080
Then update your frontend .env:

VITE_API_BASE=https://your-public-tunnel-url
Rebuild and redeploy:

npm run build
vercel --prod
📄 Sample Test PDF
Use test-template-blank.pdf for demo purposes.
It includes empty lines for fields like:

Company Name: ______________________
Contact Name: ______________________
Invoice Date: ______________________
Upload it via the frontend to start testing PDF field mapping.

✅ Developer Checklist
 Docker Desktop running

 Run docker compose up -d --build

 Backend responds at http://localhost:8080/api/health

 Frontend runs on http://localhost:5173

 PDF upload and mapping works

 Generate + download filled ZIP works

🧾 Notes
The backend automatically creates required database tables.

Mock data includes 10 companies and 10 datapoints for testing.

Mappings and templates persist until the Docker volumes are deleted.


Frontend: Vue.js

Backend: Node.js (Express)

Database: PostgreSQL

