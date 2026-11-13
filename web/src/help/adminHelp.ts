// All (i) help text lives here, one or two plain sentences per setting: what it
// does, when you would change it, and any consequence. Technical words (seconds,
// bytes, PWA, PMTiles, tailnet) may appear only in this file, never as page copy.
export const HELP = {
  // Account menu (every user)
  layout:
    "Chooses how the app looks on this device: Auto picks the phone or the computer design for you. Change it only if the wrong design shows up.",
  changePassword:
    "Lets you pick a new password for your own account. Other devices where you are signed in stay signed in.",
  passkeys:
    "A passkey lets you sign in with your fingerprint, face or device lock instead of typing a password. Add one on each device you use; you can remove it here later.",

  // Admin settings
  sessionDesktop:
    "How long someone stays signed in on a computer's web browser before they have to enter their password again. Shorter is safer on shared computers; changing it applies to new sign-ins.",
  sessionPwa:
    "How long someone stays signed in when the app was added to the iPhone Home Screen. This is usually longer, because typing a password on a phone is a nuisance.",
  sessionRememberMe:
    "How long someone stays signed in when they tick \"Keep me signed in\" at sign-in. Lower it if people share devices.",
  keepSignedInMode:
    "Chooses whether the sign-in screen offers \"Keep me signed in\", and whether it starts ticked. Choose Not offered if people share devices.",
  thumbGrid:
    "The size, in pixels, of the small pictures in the photo grid. Bigger pictures look sharper but use more disk space and load slower. Existing pictures are rebuilt only when the thumbnail cache is cleared.",
  thumbGrid2x:
    "The size, in pixels, of the grid pictures for sharp (high-resolution) screens such as iPhones and Retina Macs. Make it about twice the grid size.",
  thumbPreview:
    "The size, in pixels, of the larger picture shown while the full photo is still loading. Raise it if previews look blurry on big screens.",
  thumbQuality:
    "How much detail the small pictures keep, from 1 to 100. Higher looks better and takes more space; the default is a good balance.",
  zipLimit:
    "The biggest download of many photos at once, counted in bytes (1 GB is about 1,073,741,824 bytes). It stops one request from filling the server's disk or network.",
  mapConsent:
    "Turns on the map and on place names. People's browsers then load map pictures from OpenStreetMap, which tells that website roughly which area is being looked at; your photos are never sent. Leave it off to keep everything inside your home network.",
  mapFile:
    "A map file stored on this server (a PMTiles file) that works with no internet. It is used when the map is not allowed above, or when the online map cannot load. Leave it empty if you do not have one.",
  placeNamesDownload:
    "Downloads a public list of cities (GeoNames) once, so photos can show a place name. This is the only time the server itself contacts the internet, and no photo data is sent. It needs the map and place names option above to be on and saved.",
  checkManual:
    "Stops the automatic look for changed libraries. Then libraries are only checked when you press Check now. Use it if the photo drive should stay quiet or sleep.",
  checkInterval:
    "How often, in minutes, the server looks for photos added to or removed from each library. Shorter finds changes sooner but wakes the drive more often.",
  stableMinutes:
    "After a change is spotted, the server waits until the library has stopped changing for this many minutes before reading it again. This avoids reading a library while Photos is still copying files into it.",
  updatedNote:
    "Shows people a small message when their library has been refreshed with new photos. Turn it off if the message is distracting.",
  checkNow:
    "Looks at every library right now for changes instead of waiting for the next automatic check. Safe to press at any time; nothing is changed in your libraries.",
  allowlist:
    "Which people on your private Tailscale network (the \"tailnet\") may open this app, one name per line. Empty lets everyone on the network in. Saving a list that leaves you out is refused, so you cannot lock yourself out.",
} as const;

export type HelpKey = keyof typeof HELP;
