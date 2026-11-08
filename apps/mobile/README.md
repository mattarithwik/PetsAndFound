# PawSafe Mobile

Native Expo/React Native implementation of the PawSafe owner and shelter flows. The app is written in TypeScript/TSX; the existing HTML demo remains in `apps/demo`.

## Run with Expo Go

```bash
cd apps/mobile
npm install
npx expo start
```

Scan the QR code with the current Expo Go app. Use a physical device for the camera scan flow.

## Included flows

- Pet owner welcome and home dashboard
- Safety story game with disaster and animal choices
- Pawtricia chat with native camera capture
- Editable pet profile
- Notification settings and sign out
- Shelter member login and desktop-style ShelterDash content

The app targets Expo SDK 58, the current SDK template used by `create-expo-app` at setup time.
