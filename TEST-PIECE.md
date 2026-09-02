# Test piece

`test-piece.3mf` — one corner of the frame, at full size, in both joint styles.
About 22 cm³. Print it before committing an evening to a whole frame.

In the app there is a **Test piece** button beside Generate — it builds this for
whatever you have configured, without generating the whole frame first.

From the command line, regenerate it with:

```bash
npm run coupon                                  # 18 × 14 mm classic, 4.5 mm artwork
npm run coupon -- --artwork 2 --width 24        # thinner artwork, wider face
npm run coupon -- --preset ogee                 # a different edge profile
```

It writes `test-piece.3mf` with everything arranged on the bed, plus one STL per
part if you would rather place them yourself.

## What is in it

| Part | What it answers |
| --- | --- |
| Snap corner 1 + 2 | Does the mitre close, and does the joint click when it does? |
| Butterfly corner 1 + 2, Butterfly key | The alternative joint: key dropped in from the back |
| Spring clip | Does the tang grip its slot, and does the leaf press where the artwork will be? |

One of the snap legs carries the clip slot, so the clip has somewhere to go.

## Printing

Print exactly as arranged — the legs are already lying on their outer faces,
which is what keeps the rabbet from being an overhang. No supports. 0.2 mm
layers, 3 perimeters, 15% infill. Give it 4 perimeters if you want the joint to
feel like the real thing.

## What to check

**The mitre.** Push a snap pair together. It should close completely — the two
faces meeting with no gap — and click as it does. If it holds itself apart, the
barb is engaging too early. If it never clicks, the arms are not springing back.

**The butterfly.** Push the other pair together, then drop the key into the
recess that now spans the seam, from the back. It should need a firm push.

**The clip.** Push it into the slot in the rabbet wall, tang first. It should
start freely and then wedge over the last couple of millimetres. It should not
fall out when you turn the piece over.

**The leaf.** With the clip seated, its tip should stand a couple of millimetres
proud of where the back of your artwork would sit — that gap is the squeeze, and
it is what holds the picture against the front of the rabbet. Press it flat with
a finger: it should spring back, not stay bent.

Whatever it tells you, it costs twenty minutes instead of four hours.
