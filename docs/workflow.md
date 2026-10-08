# Posting workflow

```mermaid
sequenceDiagram
participant U as User
participant W as Netlify Web App
participant DB as PostgreSQL
participant E as Chrome Extension
participant F as Facebook
U->>W: Sign in and create campaign
W->>DB: Generate scheduled queue
U->>W: Pair extension
E->>W: Request next eligible job
W->>DB: Claim job atomically
W-->>E: Group URL and caption
E->>F: Open Facebook Group
alt Facebook login or verification required
F-->>U: Show Facebook sign-in or verification
U->>F: Complete directly on Facebook
end
U->>E: Prepare or copy caption
U->>E: Review and explicitly click Publish to Facebook
E->>W: Validate current claim
E->>F: Click the scoped Post button once
U->>F: Check the result
U->>E: Confirm the post
E->>W: Mark job posted
W->>DB: Save history and group timestamp
```

The sequence above describes manual publishing. Alternatively, the user selects a campaign with at most three groups and clicks Start automatic posting. The extension checks scheduled jobs every minute, attaches campaign images, reserves the submission on the server, and clicks Post once. A new recognizable publication notice records success; verification, approval, errors or unknown results stop the run for review. Stop prevents further submissions and cannot retract a click already sent.

