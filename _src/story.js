/* ============================================================
   story.js — Genshin-style quest narrative layer (data only)
   Keyed by main node id. The game reads this for:
     - quest panel chapter header / objective text
     - NPC dialogue intro line (before the chemistry questions)
     - completion epilogue toast
   Chemistry answers, rewards, gacha/pity/daily, locks are UNTOUCHED.
   ============================================================ */
(function (global) {
  'use strict';
  const CHAPTERS = [
    { id: 'prologue', title: 'THE BOND AWAKENS', sub: 'Chapter I · Windvale',
      line: 'The Particle Herald has fallen silent. Bonds across Windvale are coming loose.' },
    { id: 'salt', title: 'THE SALT OF THE EARTH', sub: 'Chapter II · The White Flats',
      line: 'The Salt Miner cannot keep his crystals whole. Something is unpicking the ionic lattice.' },
    { id: 'gas', title: 'A BREATH SHARED', sub: 'Chapter III · The Grotto',
      line: 'A Gas Spirit has lost its partner atom. Two nuclei, one shared pair — the old covenant is broken.' },
    { id: 'forge', title: 'THE FORGE THAT FORGOT', sub: 'Chapter IV · Ironwood',
      line: 'The Forge Keeper\'s metal no longer conducts. The sea of delocalised electrons has gone still.' },
    { id: 'water', title: 'TEARS OF THE NYMPH', sub: 'Chapter V · The Weeping Spring',
      line: 'The Water Nymph weeps salt into the spring. Her two hydrogen children have drifted at an angle.' },
    { id: 'acid', title: 'THE BITTER CHEST', sub: 'Chapter VI · The Acid Marshes',
      line: 'A sealed chest hums with a hungry bond. Only a true dot-and-cross diagram will quiet it.' },
    { id: 'air', title: 'THE WANDERER\'S RETURN', sub: 'Chapter VII · The High Road',
      line: 'The Air Wanderer circles the valley, searching for a bond that refuses to form.' },
    { id: 'methane', title: 'FOUR HANDS, ONE HEART', sub: 'Chapter VIII · The Mire',
      line: 'Deep in the mire a chest holds the pattern of four shared pairs. The Herald once called it methane.' },
    { id: 'crystal', title: 'THE HERALD\'S LAST WORD', sub: 'Finale · Chem Academy',
      line: 'The Crystal Scholar waits at the Academy. She holds the final fragment of the Herald\'s song.' }
  ];

  const STORY = {
    n1: {
      chapter: 0, client: 'Ion Sage', role: 'Keeper of the White Flats',
      intro: '"You came. Good." The sage lifts a hand and a grain of salt splits into two glowing halves. ' +
             '"Before you can mend the realm, tell me what binds these two. Na gives. Cl takes. What holds them together?"',
      objective: 'Ask the Ion Sage about the salt that is coming apart',
      done: 'The sage nods. "Electron transfer. Ionic. The first thread is rewoven."',
      reward: 'Bond fragment: IONIC'
    },
    n2: {
      chapter: 0, client: 'Salt Chest', role: 'Sealed relic of the Flats',
      intro: 'The chest will not open. Nine empty slots glow around two atoms. ' +
             '"Draw the transfer truly — one dot leaves, one cross arrives — and I will yield my fragment."',
      objective: 'Restore the salt diagram inside the Salt Chest',
      done: 'The lid falls open. A sliver of blue light rises — an ionic fragment.',
      reward: 'Diagram sealed: NaCl'
    },
    n3: {
      chapter: 1, client: 'Gas Spirit', role: 'Lost twin of the Grotto',
      intro: 'A small spirit bobs alone. "I had a twin," it whispers. "We shared everything. ' +
             'Two shells, one pair of electrons... do you still remember how we were bound?"',
      objective: 'Help the Gas Spirit remember its shared pair',
      done: 'The spirit glows and splits into two, then rejoins. "Covalent. We were always covalent."',
      reward: 'Bond fragment: COVALENT'
    },
    n4: {
      chapter: 2, client: 'Forge Keeper', role: 'Smith of Ironwood',
      intro: 'The hammer strikes cold iron and rings hollow. "Metal used to carry a charge," the keeper grumbles. ' +
             '"Now nothing moves. Tell me what flowed through this ore."',
      objective: 'Diagnose the silent metal in the Forge',
      done: 'Sparks leap along the anvil. "Delocalised electrons. Metallic. The forge remembers."',
      reward: 'Bond fragment: METALLIC'
    },
    n5: {
      chapter: 3, client: 'Water Nymph', role: 'Guardian of the Weeping Spring',
      intro: 'She cups the spring water in her hands. "My children drift apart," she says. ' +
             '"Two hydrogens, one oxygen — the angles are wrong. What do they share?"',
      objective: 'Listen to the Water Nymph and name the shared pairs',
      done: 'The droplets settle into a bent embrace. "Shared pairs. Covalent — even in water."',
      reward: 'Bond fragment: H₂O'
    },
    n6: {
      chapter: 4, client: 'Acid Chest', role: 'The hungry reliquary',
      intro: 'A sour mist curls from the seams. Something inside is still unsatisfied — ' +
             'one electron short of a full shell. The diagram must be completed to calm it.',
      objective: 'Complete the dot-and-cross diagram of the Acid Chest',
      done: 'The mist clears. The chest exhales a thin green ribbon of light.',
      reward: 'Diagram sealed: HCl'
    },
    n7: {
      chapter: 5, client: 'Air Wanderer', role: 'Voice on the High Road',
      intro: 'A traveller with no footprints hails you. "I breathe, yet I cannot bind," they say. ' +
             '"Two of me, two of the sky... what would make us one molecule?"',
      objective: 'Answer the Air Wanderer on the high road',
      done: '"A double bond," the wanderer laughs, and finally leaves a footprint.',
      reward: 'Bond fragment: O₂'
    },
    n8: {
      chapter: 6, client: 'Methane Chest', role: 'Relic of the Mire',
      intro: 'Four dark faces orbit a hidden centre. The chest speaks in the Herald\'s voice: ' +
             '"Four hands around one heart. Place every shared pair and I will open."',
      objective: 'Rebuild the four shared pairs in the Mire chest',
      done: 'Four lights click into place. The Herald\'s voice fades: "You are learning."',
      reward: 'Diagram sealed: CH₄'
    },
    n9: {
      chapter: 7, client: 'Crystal Scholar', role: 'Last voice of the Herald',
      intro: 'She stands before the Academy door, holding a fractured prism. ' +
             '"The Herald said understanding is the only weapon that never breaks. ' +
             'One last question, traveller — what makes a crystal hard?"',
      objective: 'Hear the Crystal Scholar\'s final question',
      done: 'The prism mends. "A giant covalent lattice," she smiles. "You have woven the realm back together."',
      reward: 'Bond fragment: FINAL · realm restored'
    }
  };

  function storyFor(id) { return STORY[id] || null; }
  function chapterFor(id) {
    const s = STORY[id]; if (!s) return null;
    return CHAPTERS[s.chapter] || null;
  }
  function chapterLabel(id) {
    const c = chapterFor(id);
    return c ? c.title + ' · ' + c.sub : null;
  }

  global.Story = {
    chapters: CHAPTERS, story: STORY,
    forNode: storyFor, chapterFor: chapterFor, chapterLabel: chapterLabel
  };
})(window);
