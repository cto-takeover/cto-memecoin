# X posting guide: the $CTO demo post

The hackathon requires one public post on X that says the project was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, and has the demo video attached. Its link goes into the submission as `demoUrl`, so post **before** submitting. Submission deadline: **Sun Nov 15, 06:59 WIB** (Sat Nov 14, 23:59 UTC).

## 1. Before posting

- [ ] **Pick the final cut** in `video/out/`: `cto-demo-59s.mp4` or `cto-demo-70s.mp4`. Both fit a non-premium account (videos up to 2:20). Watch it once with sound. If you pick the 59 s cut, the README's "Demo video" line (which says 70 s) needs changing.
- [ ] **Push the repo first.** The reply below says "every tx from the video" and links the repo. Those transactions live in the README's "Demo video" section and `video/txs.json`, which must be on GitHub before anyone clicks.
- [ ] **Open https://ctotimes.xyz in a private window** and check the Front page loads. People will try it straight from the post.
- [ ] **Pick a time** when you can watch replies for about an hour. 19:00–22:00 WIB is midday in Europe and morning in the US.

## 2. The main post

A non-premium account has 280 characters. X counts every link as 23 characters, every line break as 1, and the attached video as 0. Both versions are plain ASCII (no emoji, which count double).

**Version A, 279 characters (recommended wording):**

```
Most memecoins: one dev holds the keys.
$CTO: one CEO seat anyone can take for 1.4x. Old CEO gets 1.15x, the rest burns, NEAR deletes their key in the same tx.
Try it (testnet): https://ctotimes.xyz
Who should we fire next?
Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
```

**Version B, 275 characters (safer if pasting adds a stray space or line break):**

```
Most memecoins: one dev holds the keys.
$CTO: one CEO seat anyone can take for 1.4x. Old CEO gets 1.15x, the rest burns, NEAR deletes their key in that tx.
Try it (testnet): https://ctotimes.xyz
Who should we fire next?
Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
```

## 3. The first reply

Post it as a reply to your own main post, right after.

**Reply A, 164 characters:**

```
Code, contract and every tx from the video: https://github.com/cto-takeover/cto-memecoin
Narration is an AI voice; all footage is the live app on NEAR testnet. @NearLegion @NearBuilders
```

**Reply B, 179 characters (also says nothing is sold):**

```
Code, contract and every tx from the video: https://github.com/cto-takeover/cto-memecoin
Testnet only, nothing is sold. Narration is an AI voice; all footage is the live app. @NearLegion @NearBuilders
```

@NearLegion and @NearBuilders are optional tags; the rules say they bring more community reach.

## 4. Posting, step by step

1. On x.com, press **Post** to open a new post.
2. Paste the main post. Check the character counter stays below the limit (it turns red when over; the Post button then stays off).
3. Press the **media** icon and attach the video. Wait until the upload finishes.
4. Optional: once uploaded, add captions to the video by uploading `video/out/captions.srt` if X offers it for your account.
5. Press **Post**.
6. Open the post, press **Reply**, paste the reply, and post it.
7. Copy the main post's link (Share → Copy link). It looks like `https://x.com/<you>/status/<number>`.

## 5. After posting

- [ ] Send the post's link to Claude. It goes into the README (the `video-url` marker in "Demo video") and into the submission's `demoUrl`.
- [ ] Check the post in a logged-out browser window: the video plays, the link preview for ctotimes.xyz shows.
- [ ] Reply to questions in the first hour. Keep "testnet" and "nothing is sold" clear; never quote a price in dollars.
- [ ] Submit the same day. Claude prints the full submission payload first, and sends it only after you confirm.

## Why it reads this way

- **$CTO** is the cashtag, as NEAR's own posts write $NEAR. Amounts in the app stay "1,400,000 CTO", matching the on-chain symbol that wallets show; "$" never goes in front of a number.
- Unrelated tokens on BSC, Base and Solana also use $CTO, so the post says "testnet" next to the link, and the reply links the repo.
- The post follows the hackathon's advice: the first line states the problem, the video shows one complete moment, it says what NEAR does (deletes the old CEO's key in the same transaction), and it ends with a link and a real question.
- The reply discloses the AI narration, as the video's sign-off card does.
