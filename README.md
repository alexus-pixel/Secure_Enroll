# SecureEnroll

A secure online enrollment system for Caloocan City Elementary School.
Encrypted student data with Role-Based Access Control.

**Course:** Information Assurance and Security 1
**Team:** Calip, Princess Xyrine M. · Jarder, Fiona Elimarie L. · Librando, Kyle Alexus G.

## Stack
- Front-end: React (Vite)
- Back-end: Node.js + Express
- Database: PostgreSQL

## Setup
1. Clone the repo
2. `cd client && npm install`
3. `cd server && npm install`
4. Copy `server/.env.example` to `server/.env` and fill in your local database credentials
5. Front-end: `cd client && npm run dev`
6. Back-end: `cd server && npm run dev`

## Git workflow
- Never commit directly to `main`
- Branch per feature: `feature/login-page`, `feature/enrollment-form`
- Open a Pull Request and have a teammate review before merging
- Never commit `.env` or any real credentials