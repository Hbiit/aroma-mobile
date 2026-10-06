# Mobile App Revision Brief: Aroma De Luz

**Project:** Aroma De Luz Mobile Application  
**Document Type:** UI/UX & Technical Feedback Requirements  

## 1. Brand Identity & Color Palette
*   **Exact Color Matching:** Update the application's primary background and theme colors to be an *exact* match to the live website. Ensure there are no slight variations—it must not be lighter, dimmer, or darker than the official brand color.

## 2. Header & Typography
*   **App Header Redesign:** Remove the graphical icon (the flame/leaves) from the top header of the mobile app interface. 
*   **Wordmark Texture:** Retain only the "Aroma De Luz" brand name and the tagline in the header. Ensure this text utilizes the original high-quality, embossed 3D gold texture exactly as it appears in the primary brand logo.

## 3. App Assets (Icon & Splash Screen)
*   **App Icon:** Redesign the mobile app icon to be exceptionally clear, neat, and elegant. 
    *   Use the exact brand background color.
    *   *Remove* the tagline from the icon completely to ensure it scales perfectly on mobile home screens without looking cluttered.
*   **Splash / Launch Screen:** Polish the startup launch screen. It must be high-resolution, cleanly defined, and elegantly introduce the user to the app without pixelation or layout shifts.

## 4. UI Components
*   **Google Login Button:** Overhaul the "Login with Google" button. The current icon is plain and visually unappealing. Replace it with a modern, official Google 'G' logo and style the button to match the premium, luxurious aesthetic of the rest of the application.

## 5. Technical & Routing Fixes (Critical)
*   **Native In-App Authentication:** Fix the "My Account" routing error. Currently, clicking sign in/sign up redirects the user out of the app to a web browser pointing to `localhost:3000`. 
    *   **Action Required:** Remove this external web redirect. Implement a fully native, in-app authentication flow so users can create accounts and log in seamlessly without ever leaving the mobile application. Ensure the backend environment variables are updated for production rather than a local development server.