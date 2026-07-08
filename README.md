# Linkly Backend

This is the backend service for the Linkly URL shortener application. It provides REST APIs for URL shortening, user management, analytics, and subscription handling.

## Features

- User authentication and authorization
- URL shortening
- URL redirection
- Click tracking and analytics
- Subscription management
- Payment integration (PhonePe)

## Prerequisites

- Node.js (v14+ recommended)
- npm or yarn
- MongoDB (cloud or local)

## Environment Variables

Create a `.env` file in the root of the backend directory with the following variables:

```
# MongoDB connection string
DB_URL=mongodb+srv://username:password@cluster.mongodb.net/database

# JWT secret key
JWT_KEY=your_jwt_secret_key

# Session secret
SESSION_SECRET=your_session_secret

# Frontend URL for CORS
REACT_APP_FRONTEND_URL=http://localhost:3000

# Backend URL
REACT_APP_BACKEND_URL=http://localhost:8000

# Node environment
NODE_ENV=development

# Server port
PORT=8000

# Google authentication
REACT_APP_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_AUTH_PASSWORD=secure_password_for_google_auth

# Google Docs & Drive connector
GOOGLE_OAUTH_CLIENT_ID=your_google_oauth_web_client_id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your_google_oauth_web_client_secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/connectors/google/callback
```

### Google Docs & Drive connector setup

This connector is intentionally limited to Google Docs, Sheets, Slides, and
Drive file URLs. It does not request Gmail access, which keeps the consent flow
lighter for hackathon/demo usage.

1. In Google Cloud Console, create or select a project.
2. Enable Google Docs API and Google Drive API.
3. Configure the OAuth consent screen.
4. Create an OAuth Client ID with application type `Web application`.
5. Add this authorized redirect URI:
```text
http://localhost:8000/connectors/google/callback
```
6. Add the client ID, client secret, and redirect URI to `.env`.
7. Restart the backend.

The connector requests these scopes:
```text
https://www.googleapis.com/auth/documents.readonly
https://www.googleapis.com/auth/drive.readonly
```

## Installation

1. Install dependencies
```bash
npm install
```

2. Start the development server
```bash
npm run dev
```

3. For production
```bash
npm start
```

## API Endpoints

### Authentication
- `POST /register` - Register a new user
- `POST /login` - Login user
- `POST /google-auth` - Google OAuth authentication
- `GET /authenticate` - Validate user authentication
- `POST /logout` - Logout user

### URL Management
- `PATCH /loggedin/:user_id/redirect` - Create a shortened URL
- `GET /loggedin/:user_id/urls` - Get all URLs for a user
- `PATCH /linkly/:web_id` - Track click and redirect to original URL
- `DELETE /loggedin/:user_id/url` - Delete a shortened URL
- `PATCH /loggedin/:user_id/url` - Edit a shortened URL

### Subscription
- `PATCH /loggedin/:user_id/subscription` - Update user subscription

### Payment
- `POST /order` - Create a new payment order
- `POST /status` - Check payment status

## Database Schema

The application uses MongoDB with the following primary schema:

### User
- `username`: String
- `email`: String (unique)
- `password`: String (hashed)
- `subscription`: String (Free/Premium)
- `endDateOfSubscription`: Date
- `Links`: Object
  - `newLink`: Array (shortened URLs)
  - `oldLink`: Array (original URLs)
- `Viewer`: Array (click counts)

## Authentication Flow

The backend uses JWT (JSON Web Token) for authentication:
1. User registers or logs in
2. Server validates credentials and issues a JWT
3. Client includes the JWT in the Authorization header for protected requests
4. Server validates the JWT before processing protected requests

## Error Handling

The application uses a custom error handling system:
- `ApiError` class for structured error responses
- `asyncHandler` utility to handle async route handler errors

