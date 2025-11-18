# 📚 BookGenius – AI-Powered Book Recommendation App

**Built during Build & Blog Marathon: Accelerate AI with Cloud Run (Google Cloud)**

BookGenius is an AI-driven book recommendation web application. Users answer a few simple questions, and the system generates personalized book recommendations using **Google Gemini**. Saved recommendations are stored in **Firestore**, and the backend runs serverlessly on **Cloud Run**, with the frontend hosted on **Firebase Hosting**.

---

## 🚀 Features

* **AI-based recommendations** using Gemini 2.x models
* **Questionnaire flow** for personalized insights
* **Real-time Firestore save & list retrieval**
* **Serverless backend** running on Cloud Run
* **Fast Vite + React frontend** hosted on Firebase Hosting
* **CORS-free full-stack integration** via Cloud Run + Firebase Hosting

---

## 🏗️ High-Level Design

A lightweight React frontend sends user inputs to a Node.js backend running on Cloud Run.
The backend calls **Gemini** using secure secrets stored in **Google Secret Manager**, parses the model output (JSON-only format), and returns structured recommendations to the frontend.
Users can save any recommendation to **Firestore**, making it available across sessions.

---

## 🧩 Architecture

```
[ React + Vite (Firebase Hosting) ]
             |
             v
        /api/** (rewrite)
             |
      [ Cloud Run Backend ]
             |
   +---------+----------+
   |                    |
Gemini API        Firestore DB
(Generative AI)   (Saved books)
```

---

## 🔧 Tech Stack

**Frontend:** React, Vite, Firebase Hosting
**Backend:** Node.js (Express), Cloud Run (Dockerized)
**Database:** Firestore (NoSQL)
**AI:** Gemini 2.x (Generative Language API)
**CI/CD:** Cloud Build (automatic container builds)
**Secrets:** Secret Manager (Gemini API Key)