# Neura app — chat layout, wiki setup, and UI refinements

Implementation status and acceptance criteria: [Neura roadmap tracker](tracker.md).

# Your Chats and Teams Chat Fixes

- Your Chats section: show only first few recent conversations, with “load more” option
  - Keeps list collapsed so Teams chat stays visible
  - Currently, Teams chat gets pushed down as new private chats are added
- Your Chats section should be collapsible

# Security and Settings Restructure

- Create a dedicated Security page under Personal settings
  - Move passkeys, sign-in methods, etc. out of the current personalization section and into the Settings app

# Wiki Setup

- Wiki created at: https://github.com/Alshival-Ai/neural-labs/wiki
- Pages to build out:
  1. General introduction to Neura Labs (what it is, what it can do)
  2. Installation guide
  3. Technical docs: Twilio setup, Outlook sign-in, etc.

# Terminal, Chat, and UI Improvements

- Reaction bar in Teams terminal
  - Replace current “send an emoji sticker” image with a right sidebar
  - Sidebar icons: emoji picker and GIF picker (Clippy API key available from another project if needed)
- Image and file attachment cleanup
  - Images: embed directly, no filename or size metadata shown
  - Other files (e.g. Excel): show filename once on the attachment only, not repeated in the message body
  - All attachments: add right-click menu with “Download to Workspace” (saves within Neura Labs) and “Download” (saves to local computer)
- Plugins page redesign
  - Rebuild with cards, matching the model provider page style (e.g. OpenAI, Claude cards)
  - Example: a dedicated Twilio card for setup
- Window snapping
  - Drag to left or right edge: snap to that side
  - Drag to top: option to expand/maximize
- Top bar behavior change
  - Always show as a hover-reveal dropdown, even when a window is not maximized
  - Currently the bar blocks that space unless the window is maximized


  # Transcript
  Meeting Title: Neura app — chat layout, wiki setup, and UI refinements
Date: Sep 6
Meeting participants: Samuel Cavazos

Transcript:
Me: These are things that we need to work on in the Neura app. In the Neura app. Within Neura Labs. The Your Chat section. Should be. Showing the first few recent conversations. And then load more or something. So that. It is collapsed. And we can see the Teams chat. Right now. As you open new chats, the Teams chat gets pushed down further down, and we have to scroll farther. And farther as we add more new private chats. So we want that team chat. Fixed. Um, And the your chats should be collapsible. In the personalization settings, we have a security section. We have to create a dedicated security page under personal. So personal security within the Settings app. And so we would want to move all of that. Into. Settings app. For security. So passkey, sign-in methods. Um. And so forth. I just turned on the wiki, so we need a wiki user, uh, user guide for week, you know, we need a wiki with a user guide and technical documentation. So first, um, Pages that the user sees on the wiki is set up and, you know, just general. About information about NeuroLabs, what it is, what it can do. And how to— well, no, first it's just a general introduction, then we'll have an installation. Page in the wiki. And then some other technical documentation, like if you want to set up your Twilio or Outlook, sign in with Outlook and, you know, all of that good stuff. So we'll need some. Well-thought-out wiki page. Or wiki for the repo. I already created the repo in GitHub, so Alshival AI Neuro Labs. Wiki. That's the one where I'll put it in the notes here. Great. In the terminal app within the team terminals, I want a reaction bar. Right now we have an image here that says send an emoji sticker. Right. So what I think is on the Teams terminal, we can use a write. Sidebar. Um, And in there we can have an icon for emojis and it opens, you know, an emoji picker. But also a clip. Clippy. So we want a GIF, so we want emoji and then GIF, and so We have a Clippy API key that we use. For the MCP server that we can. Oh wait, do we have a Clippy API? We may or may not, but if we don't, I have the API key in another project and I can give that to you. But. We also want that GIF so they would be able to. Pick a GIF, like a GIF picker. I noticed when I upload an image. To the chat or the team chat. In the Neura app. It says the file name. And then it says the file name again. So it'll say the file name on the attachment, like the attached image. And then it'll say the file name again. On the. Message. So for that, I like— if I send an image, I may not want the file name to show. I think just embedding the image is fine. Um, and we don't— and then, um, and don't even need the size. Um, so we just like, if I put an image, I just want the image to be uploaded. Like onto the chat naturally without. Extra metadata. And then I want to write, like, if I send con— on images and other files that I send. Same thing, right? Like if I send an Excel file or over the chat, I don't want them. I'm gonna try to send an Excel. Yeah, we could just— we don't need the double. For Excel files, we could just put the file name. And then once, like with the attachment, and then the message doesn't need to include the file name. But with all files that are attached also. We want to have a right-click. We want to be able to right-click them. And then download. To workspace, which would mean like you save it within the Neural Labs app. And then also a download, which would download it to your computer off the browser. I want to remake the plugins page in the settings app. So the model provider page has these cards where like OpenAI, and then you could set it up, and Claude, and they're really nice. So I want the plugins page to have cards as well, but for the plugins. If that makes sense. Right now it's sort of all like, we'll have a Twilio card, like for setting up the Twilio, for example. Oh, it would be nice to have snap edges if I grab a window like a terminal or whatever, a Neura app. And I drag it to the very, very side. It would sort of give me the option to snap, right? To the left. Or the right. If I move the window to the very top. Right. It should give me an option to sort of expand in the corner, right? And I could, you know, just very ability to snap. Windows and have a lot of control over, over the layout. Um, I also, I would like for the top NeuroLabs with the workspace ready, the time, that top bar. That was always, um, because right now if a window's not expanded, I can't put the window over it. If I maximize the window. I am able. To expand over that. But And then it shows when I hover over. I would rather always have it. So that when I hover on the top, the top bar shows. Because then even when my window's not maximized, I would be able to use that space. Right now that space is blocked off by the top bar. And, um, and I have to maximize to hide the top bar. So just always having the top bar as a dropdown. And maybe we can— I don't know how long it takes. That's not too bad. Yeah. That was that. And then
