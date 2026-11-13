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

  // Admin People and Sharing
  personRole:
    "An administrator can change everything in this panel. Everyone else can only look at the libraries you share with them. An administrator still has to share a library with themselves to see its photos.",
  personSignIn:
    "Turn off to stop this person using the app. Their sharing choices are kept, and you can turn it back on any time. Use it instead of deleting when someone is away.",
  personPassword:
    "Sets a new password. They need it the next time they sign in, and they are signed out everywhere else.",
  personUnlock:
    "After too many wrong passwords an account is locked for a while. This lets the person try again right away. Use it when someone cannot sign in even with the right password.",
  personDelete:
    "Removes the account for good. Your libraries and photos are not touched. Use Allowed to sign in instead if you may want the account back.",
  invitation:
    "An invitation is a one-time link. Send it to the person and they pick their own name and password. It stops working after 7 days or once it has been used.",

  // Admin settings
  sessionDesktop:
    "How long someone stays signed in on a computer's web browser before they have to enter their password again. Shorter is safer on shared computers; changing it applies to new sign-ins.",
  sessionPwa:
    "How long someone stays signed in when the app was added to the iPhone Home Screen. This is usually longer, because typing a password on a phone is a nuisance.",
  sessionRememberMe:
    "How long someone stays signed in when they tick \"Remember me\" at sign-in. Lower it if people share devices.",
  pictureQuality:
    "How sharp the small pictures in the grid and the preview are. High looks sharper on big or very sharp screens but uses more disk space and loads a little slower. Standard suits most people. Pictures already made are rebuilt only after the picture cache is cleared.",
  cacheSize:
    "How much disk space the small pictures may use. When it is full, the oldest pictures are removed first and made again when someone looks at them. Bigger means fewer rebuilds.",
  zipLimit:
    "The biggest download of many photos at once. A bigger limit lets people take more in one go but uses more disk space and takes longer. It stops one request from filling the server's disk or network.",
  mapConsent:
    "Turns on the map and on place names. People's browsers then load map pictures from OpenStreetMap, which tells that website roughly which area is being looked at; your photos are never sent. Each person's browser fetches these from tile.openstreetmap.org while a map is open; this server never does. Until you agree, nothing is downloaded and place names are off; the map stays blank unless an offline map file is set under Advanced.",
  mapFile:
    "A map file stored on this server (a PMTiles file) that works with no internet. It is used when the map is not allowed above, or when the online map cannot load. Leave it empty if you do not have one.",
  placeNamesDownload:
    "Downloads a public list of cities (GeoNames) once, so photos can show a place name. This is the only time the server itself contacts the internet, and no photo data is sent. It needs the map and place names option above to be on and saved.",
  checkInterval:
    "How often the app looks for photos added to or removed from your libraries. More often finds changes sooner but wakes the drive more often. Never means libraries are only checked when you press Check Now; use it if the photo drive should stay quiet or sleep.",
  stableMinutes:
    "After a change is spotted, the server waits until the library has stopped changing for this many minutes before reading it again. This avoids reading a library while Photos is still copying files into it.",
  updatedNote:
    "Shows people a small message when their library has been refreshed with new photos. Turn it off if the message is distracting.",
  checkNow:
    "Looks at every library right now for changes instead of waiting for the next automatic check. Safe to press at any time; nothing is changed in your libraries.",
  allowlist:
    "Which people on your private Tailscale network (the \"tailnet\") may open this app, one name per line. Empty lets everyone on the network in. Saving a list that leaves you out is refused, so you cannot lock yourself out.",
  // Libraries
  libAdd:
    "Shows the Photos libraries found in your folders. Pick one to add it to this app. The library files are only read, never changed.",
  libFolders:
    "A folder on the computer that runs this app, with your Photos libraries inside. Removing a folder here only stops looking in it; no files are deleted.",
  libRename:
    "Changes the name people see in the app. The library file keeps its name.",
  libCheck:
    "Reads the library again and updates this app's list of photos. Your library files are not changed. Use it right after you copy new photos in and don't want to wait for the automatic check; big libraries can take a few minutes.",
  libReplace:
    "Points this library at a different Photos library file, for example after you copied a newer version over. The name, who can see it and the settings stay the same. You see what changes before anything happens.",
  libPrepare:
    "Makes all the small preview pictures ahead of time, so browsing is fast the first time. It uses some disk space and processor time while it runs, and you can pause. Use it once after adding a big library, ideally when nobody is using the app.",
  libPause:
    "Stops preparing thumbnails and keeps what is done. Resume continues where it stopped. Use it if the server feels slow.",
  libDeleteCache:
    "Deletes the small preview pictures this app made. They are made again when needed. Your photos are not touched. Use it to free disk space, or if previews look wrong.",
  libHistory:
    "The last few times this library was read again, with what changed.",
  libRemove:
    "Takes this library out of the app. People will no longer see it. The photos and the library file stay exactly where they are. You can add it again later, but sharing choices have to be set again.",
} as const;

export type HelpKey = keyof typeof HELP;
