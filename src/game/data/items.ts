import type { BaseItem, EquipSlot } from '../types';

/**
 * Base item pool. Each base combines with a rolled Rarity tier at drop time,
 * so the effective item count is BASE_ITEMS.length x RARITY_TIERS.length.
 *
 * ---------------------------------------------------------------------------
 * WEAPON ABILITY CONTRACT (for the combat workstream)
 * ---------------------------------------------------------------------------
 * Every weapon carries an `abilityId` describing the *fantasy* of the family it
 * belongs to. Combat resolves the id to a concrete Ability; unknown ids should
 * fall back to a plain heavy strike. Ten weapon families exist:
 *
 *   cleave    — axes & polearms: wide arc, hits everything, big flat damage
 *   drain     — scythes & soul weapons: damage that heals the wielder
 *   bash      — hammers, mauls, flails, picks: heavy hit that can stun
 *   pierce    — spears, tridents, lances, rapiers: ignores a chunk of defense
 *   backstab  — daggers & katanas: cheap, high crit, extra hit
 *   volley    — bows & thrown: multi-hit, scales with speed
 *   fireball  — staves & wands: burn damage over time
 *   hex       — sceptres: weaken/curse the target
 *   flurry    — fists, claws, gauntlets: many small hits, builds energy
 *   execute   — swords & greatswords: bonus damage to low-health targets
 *
 * Three offhand families grant a secondary ability:
 *   bulwark   — shields: shield/fortify the wielder
 *   frostbolt — tomes & grimoires: ranged hit that slows
 *   mend      — totems & charms: self heal / regen
 * ---------------------------------------------------------------------------
 */
export const BASE_ITEMS: BaseItem[] = [
  /* -------------------------------------------------------------- weapons -- */
  { id: 'w_fists', slot: 'weapon', name: 'Fists', icon: '✊', statKey: 'atk', baseValue: 2, minLevel: 1, abilityId: 'flurry' },
  { id: 'w_dagger', slot: 'weapon', name: 'Dagger', icon: '🔪', statKey: 'atk', baseValue: 4, minLevel: 1, abilityId: 'backstab' },
  { id: 'w_shortsword', slot: 'weapon', name: 'Shortsword', icon: '⚔️', statKey: 'atk', baseValue: 6, minLevel: 2, abilityId: 'execute' },
  { id: 'w_axe', slot: 'weapon', name: 'Hand Axe', icon: '🪓', statKey: 'atk', baseValue: 7, minLevel: 3, abilityId: 'cleave' },
  { id: 'w_spear', slot: 'weapon', name: 'Spear', icon: '🔱', statKey: 'atk', baseValue: 8, minLevel: 4, abilityId: 'pierce' },
  { id: 'w_bow', slot: 'weapon', name: 'Hunting Bow', icon: '🏹', statKey: 'atk', baseValue: 9, minLevel: 5, abilityId: 'volley' },
  { id: 'w_hammer', slot: 'weapon', name: 'War Hammer', icon: '🔨', statKey: 'atk', baseValue: 10, minLevel: 6, abilityId: 'bash' },
  { id: 'w_claws', slot: 'weapon', name: 'Beast Claws', icon: '🐾', statKey: 'atk', baseValue: 11, minLevel: 7, abilityId: 'flurry' },
  { id: 'w_scythe', slot: 'weapon', name: 'Scythe', icon: '☠️', statKey: 'atk', baseValue: 13, minLevel: 9, abilityId: 'drain' },
  { id: 'w_blade', slot: 'weapon', name: 'Greatblade', icon: '🗡️', statKey: 'atk', baseValue: 15, minLevel: 11, abilityId: 'execute' },
  { id: 'w_staff', slot: 'weapon', name: 'Arcane Staff', icon: '🪄', statKey: 'atk', baseValue: 17, minLevel: 13, abilityId: 'fireball' },
  { id: 'w_gauntlet', slot: 'weapon', name: 'Runed Gauntlet', icon: '🥊', statKey: 'atk', baseValue: 19, minLevel: 15, abilityId: 'flurry' },
  { id: 'w_flail', slot: 'weapon', name: 'Spiked Flail', icon: '⛓️', statKey: 'atk', baseValue: 21, minLevel: 17, abilityId: 'bash' },
  { id: 'w_katana', slot: 'weapon', name: 'Moonlit Katana', icon: '🎴', statKey: 'atk', baseValue: 23, minLevel: 19, abilityId: 'backstab' },
  { id: 'w_trident', slot: 'weapon', name: 'Storm Trident', icon: '🔱', statKey: 'atk', baseValue: 25, minLevel: 21, abilityId: 'pierce' },
  { id: 'w_warpick', slot: 'weapon', name: 'War Pick', icon: '⛏️', statKey: 'atk', baseValue: 27, minLevel: 23, abilityId: 'bash' },
  { id: 'w_chakram', slot: 'weapon', name: 'Bloodmoon Chakram', icon: '💫', statKey: 'atk', baseValue: 29, minLevel: 25, abilityId: 'volley' },
  { id: 'w_glaive', slot: 'weapon', name: 'Frost Glaive', icon: '❄️', statKey: 'atk', baseValue: 31, minLevel: 27, abilityId: 'cleave' },
  { id: 'w_wand', slot: 'weapon', name: 'Ember Wand', icon: '🔥', statKey: 'atk', baseValue: 33, minLevel: 29, abilityId: 'fireball' },
  { id: 'w_cutlass', slot: 'weapon', name: 'Ghostlight Cutlass', icon: '🏴‍☠️', statKey: 'atk', baseValue: 35, minLevel: 31, abilityId: 'execute' },
  { id: 'w_maul', slot: 'weapon', name: 'Titan Maul', icon: '🪨', statKey: 'atk', baseValue: 37, minLevel: 33, abilityId: 'bash' },
  { id: 'w_rapier', slot: 'weapon', name: 'Starlight Rapier', icon: '✨', statKey: 'atk', baseValue: 39, minLevel: 35, abilityId: 'pierce' },
  { id: 'w_greataxe', slot: 'weapon', name: 'Doomsplitter Greataxe', icon: '🪓', statKey: 'atk', baseValue: 41, minLevel: 37, abilityId: 'cleave' },
  { id: 'w_voidblade', slot: 'weapon', name: 'Voidforged Blade', icon: '🌑', statKey: 'atk', baseValue: 43, minLevel: 39, abilityId: 'execute' },
  { id: 'w_sceptre', slot: 'weapon', name: 'Sceptre of Ruin', icon: '🔯', statKey: 'atk', baseValue: 45, minLevel: 41, abilityId: 'hex' },
  { id: 'w_lance', slot: 'weapon', name: 'Dawnbreaker Lance', icon: '🌅', statKey: 'atk', baseValue: 47, minLevel: 43, abilityId: 'pierce' },
  { id: 'w_reaper', slot: 'weapon', name: 'Soul Reaper', icon: '💀', statKey: 'atk', baseValue: 49, minLevel: 45, abilityId: 'drain' },
  { id: 'w_starforge', slot: 'weapon', name: 'Starforge Edge', icon: '⭐', statKey: 'atk', baseValue: 52, minLevel: 47, abilityId: 'execute' },

  /* ---------------------------------------------------------------- armor -- */
  { id: 'a_rags', slot: 'armor', name: 'Rags', icon: '👕', statKey: 'def', baseValue: 1, minLevel: 1 },
  { id: 'a_leather', slot: 'armor', name: 'Leather Vest', icon: '🥋', statKey: 'def', baseValue: 3, minLevel: 1 },
  { id: 'a_chain', slot: 'armor', name: 'Chainmail', icon: '🧥', statKey: 'def', baseValue: 5, minLevel: 3 },
  { id: 'a_robe', slot: 'armor', name: 'Woven Robe', icon: '🧵', statKey: 'hp', baseValue: 18, minLevel: 4 },
  { id: 'a_plate', slot: 'armor', name: 'Plate Armor', icon: '🛡️', statKey: 'def', baseValue: 7, minLevel: 5 },
  { id: 'a_scale', slot: 'armor', name: 'Scale Armor', icon: '🦎', statKey: 'def', baseValue: 8, minLevel: 6 },
  { id: 'a_vitalvest', slot: 'armor', name: 'Vital Vest', icon: '❤️', statKey: 'hp', baseValue: 30, minLevel: 7 },
  { id: 'a_cloak', slot: 'armor', name: 'Shadow Cloak', icon: '🦇', statKey: 'def', baseValue: 10, minLevel: 8 },
  { id: 'a_bulwark', slot: 'armor', name: 'Bulwark Plate', icon: '🛡️', statKey: 'def', baseValue: 13, minLevel: 10 },
  { id: 'a_soulguard', slot: 'armor', name: 'Soulguard', icon: '👻', statKey: 'hp', baseValue: 45, minLevel: 12 },
  { id: 'a_dragonhide', slot: 'armor', name: 'Dragonhide', icon: '🐉', statKey: 'def', baseValue: 16, minLevel: 13 },
  { id: 'a_stoneskin', slot: 'armor', name: 'Stoneskin Mail', icon: '🪨', statKey: 'def', baseValue: 20, minLevel: 15 },
  { id: 'a_ironhide', slot: 'armor', name: 'Ironhide Jerkin', icon: '🐗', statKey: 'hp', baseValue: 55, minLevel: 16 },
  { id: 'a_warplate', slot: 'armor', name: 'Warplate Harness', icon: '🛡️', statKey: 'def', baseValue: 24, minLevel: 17 },
  { id: 'a_runeplate', slot: 'armor', name: 'Runeforged Plate', icon: '🔷', statKey: 'def', baseValue: 28, minLevel: 19 },
  { id: 'a_ancestral', slot: 'armor', name: 'Ancestral Vestments', icon: '🕯️', statKey: 'hp', baseValue: 70, minLevel: 20 },
  { id: 'a_wraithweave', slot: 'armor', name: 'Wraithweave Cloak', icon: '👻', statKey: 'def', baseValue: 32, minLevel: 21 },
  { id: 'a_bastion', slot: 'armor', name: 'Bastion Cuirass', icon: '🏰', statKey: 'def', baseValue: 36, minLevel: 23 },
  { id: 'a_dragonscale', slot: 'armor', name: 'Dragonscale Hauberk', icon: '🐲', statKey: 'hp', baseValue: 90, minLevel: 24 },
  { id: 'a_frostguard', slot: 'armor', name: 'Frostguard Mail', icon: '🧊', statKey: 'def', baseValue: 40, minLevel: 25 },
  { id: 'a_voidplate', slot: 'armor', name: 'Voidplate Armor', icon: '🌑', statKey: 'def', baseValue: 44, minLevel: 27 },
  { id: 'a_phoenixplate', slot: 'armor', name: 'Phoenixplate', icon: '🔥', statKey: 'hp', baseValue: 110, minLevel: 28 },
  { id: 'a_titanguard', slot: 'armor', name: 'Titanguard', icon: '🗿', statKey: 'def', baseValue: 48, minLevel: 29 },
  { id: 'a_celestial', slot: 'armor', name: 'Celestial Aegis', icon: '☄️', statKey: 'def', baseValue: 52, minLevel: 31 },
  { id: 'a_ironwill', slot: 'armor', name: 'Ironwill Bulwark', icon: '💪', statKey: 'hp', baseValue: 130, minLevel: 32 },
  { id: 'a_shadowplate', slot: 'armor', name: 'Shadowplate', icon: '⚫', statKey: 'def', baseValue: 56, minLevel: 33 },
  { id: 'a_stormguard', slot: 'armor', name: 'Stormguard Plate', icon: '⚡', statKey: 'def', baseValue: 60, minLevel: 35 },
  { id: 'a_worldshell', slot: 'armor', name: 'Worldshell Armor', icon: '🌍', statKey: 'def', baseValue: 66, minLevel: 39 },

  /* ----------------------------------------------------------------- helm -- */
  { id: 'h_cap', slot: 'helm', name: 'Cloth Cap', icon: '🧢', statKey: 'def', baseValue: 1, minLevel: 1 },
  { id: 'h_hood', slot: 'helm', name: 'Leather Hood', icon: '🎩', statKey: 'def', baseValue: 2, minLevel: 2 },
  { id: 'h_circlet', slot: 'helm', name: 'Copper Circlet', icon: '⭕', statKey: 'hp', baseValue: 10, minLevel: 3 },
  { id: 'h_barbute', slot: 'helm', name: 'Iron Barbute', icon: '🪖', statKey: 'def', baseValue: 4, minLevel: 5 },
  { id: 'h_wolfhood', slot: 'helm', name: 'Wolfhood', icon: '🐺', statKey: 'def', baseValue: 5, minLevel: 6, setId: 'set_wolf' },
  { id: 'h_hornhelm', slot: 'helm', name: 'Horned Helm', icon: '🐂', statKey: 'atk', baseValue: 3, minLevel: 7 },
  { id: 'h_visor', slot: 'helm', name: 'Steel Visor', icon: '🥽', statKey: 'def', baseValue: 8, minLevel: 9 },
  { id: 'h_mask', slot: 'helm', name: 'Bone Mask', icon: '💀', statKey: 'critChance', baseValue: 0.05, minLevel: 11 },
  { id: 'h_ironhelm', slot: 'helm', name: 'Ironbound Helm', icon: '🪖', statKey: 'def', baseValue: 11, minLevel: 13, setId: 'set_iron' },
  { id: 'h_greathelm', slot: 'helm', name: 'Greathelm', icon: '🛡️', statKey: 'def', baseValue: 13, minLevel: 14 },
  { id: 'h_thorncrown', slot: 'helm', name: 'Thorn Crown', icon: '🌿', statKey: 'critDamage', baseValue: 0.1, minLevel: 16 },
  { id: 'h_warhelm', slot: 'helm', name: 'Warhelm', icon: '⚔️', statKey: 'def', baseValue: 18, minLevel: 18 },
  { id: 'h_seercowl', slot: 'helm', name: 'Seer Cowl', icon: '🔮', statKey: 'hp', baseValue: 55, minLevel: 19 },
  { id: 'h_embercrown', slot: 'helm', name: 'Ember Crown', icon: '🔥', statKey: 'def', baseValue: 22, minLevel: 20, setId: 'set_ember' },
  { id: 'h_dragonhelm', slot: 'helm', name: 'Dragon Helm', icon: '🐲', statKey: 'def', baseValue: 24, minLevel: 22 },
  { id: 'h_shadowhood', slot: 'helm', name: 'Shadow Hood', icon: '🕶️', statKey: 'critChance', baseValue: 0.12, minLevel: 24 },
  { id: 'h_titanhelm', slot: 'helm', name: 'Titan Helm', icon: '🗿', statKey: 'def', baseValue: 30, minLevel: 26 },
  { id: 'h_tidecrest', slot: 'helm', name: 'Tidecrest Helm', icon: '🌊', statKey: 'def', baseValue: 32, minLevel: 27, setId: 'set_tide' },
  { id: 'h_starcirclet', slot: 'helm', name: 'Star Circlet', icon: '✨', statKey: 'hp', baseValue: 90, minLevel: 28 },
  { id: 'h_grimhelm', slot: 'helm', name: 'Grim Helm', icon: '☠️', statKey: 'def', baseValue: 36, minLevel: 30 },
  { id: 'h_aegishelm', slot: 'helm', name: 'Aegis Helm', icon: '🔰', statKey: 'def', baseValue: 40, minLevel: 33 },
  { id: 'h_voidcrown', slot: 'helm', name: 'Void Crown', icon: '🌑', statKey: 'def', baseValue: 43, minLevel: 34, setId: 'set_void' },
  { id: 'h_phoenixcrest', slot: 'helm', name: 'Phoenix Crest', icon: '🕊️', statKey: 'hp', baseValue: 130, minLevel: 36 },
  { id: 'h_stormcrown', slot: 'helm', name: 'Storm Crown', icon: '⚡', statKey: 'def', baseValue: 47, minLevel: 38 },
  { id: 'h_dawnhelm', slot: 'helm', name: 'Dawnward Helm', icon: '🌅', statKey: 'def', baseValue: 52, minLevel: 42, setId: 'set_dawn' },
  { id: 'h_worldcrown', slot: 'helm', name: 'Crown of Worlds', icon: '🌍', statKey: 'def', baseValue: 56, minLevel: 45 },

  /* -------------------------------------------------------------- offhand -- */
  { id: 'o_buckler', slot: 'offhand', name: 'Wooden Buckler', icon: '🪵', statKey: 'def', baseValue: 2, minLevel: 1, abilityId: 'bulwark' },
  { id: 'o_torch', slot: 'offhand', name: 'Burning Torch', icon: '🔦', statKey: 'atk', baseValue: 2, minLevel: 1 },
  { id: 'o_ironshield', slot: 'offhand', name: 'Iron Shield', icon: '🛡️', statKey: 'def', baseValue: 4, minLevel: 3, abilityId: 'bulwark' },
  { id: 'o_lantern', slot: 'offhand', name: 'Warding Lantern', icon: '🏮', statKey: 'hp', baseValue: 20, minLevel: 4 },
  { id: 'o_quiver', slot: 'offhand', name: 'Hunting Quiver', icon: '🎯', statKey: 'atk', baseValue: 4, minLevel: 5 },
  { id: 'o_wolfcharm', slot: 'offhand', name: 'Wolf Charm', icon: '🐺', statKey: 'critChance', baseValue: 0.05, minLevel: 6, setId: 'set_wolf', abilityId: 'mend' },
  { id: 'o_tome', slot: 'offhand', name: 'Apprentice Tome', icon: '📖', statKey: 'critDamage', baseValue: 0.12, minLevel: 7, abilityId: 'frostbolt' },
  { id: 'o_kiteshield', slot: 'offhand', name: 'Kite Shield', icon: '🛡️', statKey: 'def', baseValue: 7, minLevel: 8, abilityId: 'bulwark' },
  { id: 'o_totem', slot: 'offhand', name: 'Spirit Totem', icon: '🗿', statKey: 'lifesteal', baseValue: 0.03, minLevel: 10, abilityId: 'mend' },
  { id: 'o_parryblade', slot: 'offhand', name: 'Parrying Blade', icon: '🗡️', statKey: 'atk', baseValue: 7, minLevel: 11 },
  { id: 'o_towershield', slot: 'offhand', name: 'Ironbound Tower Shield', icon: '🚪', statKey: 'def', baseValue: 12, minLevel: 13, setId: 'set_iron', abilityId: 'bulwark' },
  { id: 'o_grimoire', slot: 'offhand', name: 'Grimoire of Frost', icon: '❄️', statKey: 'critDamage', baseValue: 0.2, minLevel: 15, abilityId: 'frostbolt' },
  { id: 'o_bulwarkshield', slot: 'offhand', name: 'Bulwark Shield', icon: '🏰', statKey: 'def', baseValue: 17, minLevel: 17, abilityId: 'bulwark' },
  { id: 'o_banner', slot: 'offhand', name: 'War Banner', icon: '🚩', statKey: 'atk', baseValue: 14, minLevel: 19 },
  { id: 'o_embertome', slot: 'offhand', name: 'Ember Tome', icon: '🔥', statKey: 'atk', baseValue: 15, minLevel: 20, setId: 'set_ember', abilityId: 'fireball' },
  { id: 'o_skull', slot: 'offhand', name: 'Screaming Skull', icon: '💀', statKey: 'lifesteal', baseValue: 0.06, minLevel: 21, abilityId: 'mend' },
  { id: 'o_dragonshield', slot: 'offhand', name: 'Dragonscale Shield', icon: '🐲', statKey: 'def', baseValue: 26, minLevel: 24, abilityId: 'bulwark' },
  { id: 'o_moonlens', slot: 'offhand', name: 'Moon Lens', icon: '🌙', statKey: 'critChance', baseValue: 0.15, minLevel: 26 },
  { id: 'o_tideward', slot: 'offhand', name: 'Tideward Bulwark', icon: '🌊', statKey: 'def', baseValue: 31, minLevel: 27, setId: 'set_tide', abilityId: 'bulwark' },
  { id: 'o_soulcandle', slot: 'offhand', name: 'Soul Candle', icon: '🕯️', statKey: 'hp', baseValue: 100, minLevel: 29 },
  { id: 'o_aegis', slot: 'offhand', name: 'Aegis of Ruin', icon: '🔱', statKey: 'def', baseValue: 34, minLevel: 31, abilityId: 'bulwark' },
  { id: 'o_voidsigil', slot: 'offhand', name: 'Void Sigil', icon: '🌑', statKey: 'atk', baseValue: 24, minLevel: 34, setId: 'set_void', abilityId: 'hex' },
  { id: 'o_starbook', slot: 'offhand', name: 'Codex of Stars', icon: '📕', statKey: 'critDamage', baseValue: 0.35, minLevel: 35, abilityId: 'frostbolt' },
  { id: 'o_stormcoil', slot: 'offhand', name: 'Storm Coil', icon: '⚡', statKey: 'speed', baseValue: 12, minLevel: 37 },
  { id: 'o_dawnshield', slot: 'offhand', name: 'Dawnward Aegis', icon: '🌅', statKey: 'def', baseValue: 46, minLevel: 42, setId: 'set_dawn', abilityId: 'bulwark' },
  { id: 'o_worldheart', slot: 'offhand', name: 'Heart of the World', icon: '🌍', statKey: 'hp', baseValue: 180, minLevel: 44 },

  /* ---------------------------------------------------------------- boots -- */
  { id: 'b_sandals', slot: 'boots', name: 'Worn Sandals', icon: '🩴', statKey: 'speed', baseValue: 1, minLevel: 1 },
  { id: 'b_leatherboots', slot: 'boots', name: 'Leather Boots', icon: '🥾', statKey: 'def', baseValue: 2, minLevel: 1 },
  { id: 'b_swiftshoes', slot: 'boots', name: 'Swift Shoes', icon: '👟', statKey: 'speed', baseValue: 3, minLevel: 3 },
  { id: 'b_ironboots', slot: 'boots', name: 'Iron Sabatons', icon: '🦿', statKey: 'def', baseValue: 4, minLevel: 5 },
  { id: 'b_wolfstride', slot: 'boots', name: 'Wolfstride Boots', icon: '🐺', statKey: 'speed', baseValue: 5, minLevel: 6, setId: 'set_wolf' },
  { id: 'b_trailboots', slot: 'boots', name: 'Trailblazers', icon: '🧭', statKey: 'hp', baseValue: 22, minLevel: 7 },
  { id: 'b_windwalkers', slot: 'boots', name: 'Windwalkers', icon: '🌬️', statKey: 'speed', baseValue: 8, minLevel: 9 },
  { id: 'b_shadowsteps', slot: 'boots', name: 'Shadow Steps', icon: '👣', statKey: 'critChance', baseValue: 0.06, minLevel: 11 },
  { id: 'b_ironsollerets', slot: 'boots', name: 'Ironbound Sollerets', icon: '🥾', statKey: 'def', baseValue: 10, minLevel: 13, setId: 'set_iron' },
  { id: 'b_greaves', slot: 'boots', name: 'Steel Greaves', icon: '🛡️', statKey: 'def', baseValue: 13, minLevel: 14 },
  { id: 'b_bounding', slot: 'boots', name: 'Boots of Bounding', icon: '🦘', statKey: 'speed', baseValue: 11, minLevel: 16 },
  { id: 'b_dragonboots', slot: 'boots', name: 'Dragonhide Boots', icon: '🐲', statKey: 'def', baseValue: 18, minLevel: 18 },
  { id: 'b_pilgrim', slot: 'boots', name: 'Pilgrim Treads', icon: '🥿', statKey: 'hp', baseValue: 60, minLevel: 19 },
  { id: 'b_emberstride', slot: 'boots', name: 'Ember Striders', icon: '🔥', statKey: 'speed', baseValue: 14, minLevel: 20, setId: 'set_ember' },
  { id: 'b_stormsteps', slot: 'boots', name: 'Storm Steps', icon: '⚡', statKey: 'speed', baseValue: 16, minLevel: 22 },
  { id: 'b_titansteps', slot: 'boots', name: 'Titan Steps', icon: '🗿', statKey: 'def', baseValue: 26, minLevel: 25 },
  { id: 'b_tidewalkers', slot: 'boots', name: 'Tidewalker Greaves', icon: '🌊', statKey: 'def', baseValue: 30, minLevel: 27, setId: 'set_tide' },
  { id: 'b_phantom', slot: 'boots', name: 'Phantom Slippers', icon: '👻', statKey: 'critChance', baseValue: 0.14, minLevel: 28 },
  { id: 'b_bulwarkboots', slot: 'boots', name: 'Bulwark Greaves', icon: '🏰', statKey: 'def', baseValue: 34, minLevel: 30 },
  { id: 'b_starstriders', slot: 'boots', name: 'Star Striders', icon: '✨', statKey: 'speed', baseValue: 22, minLevel: 32 },
  { id: 'b_voidtreads', slot: 'boots', name: 'Void Treads', icon: '🌑', statKey: 'speed', baseValue: 25, minLevel: 34, setId: 'set_void' },
  { id: 'b_seraphboots', slot: 'boots', name: 'Seraph Boots', icon: '🕊️', statKey: 'hp', baseValue: 140, minLevel: 36 },
  { id: 'b_stormgreaves', slot: 'boots', name: 'Stormcaller Greaves', icon: '🌩️', statKey: 'def', baseValue: 44, minLevel: 38 },
  { id: 'b_dawnsteps', slot: 'boots', name: 'Dawnward Steps', icon: '🌅', statKey: 'def', baseValue: 50, minLevel: 42, setId: 'set_dawn' },
  { id: 'b_worldwalkers', slot: 'boots', name: 'Worldwalkers', icon: '🌍', statKey: 'speed', baseValue: 32, minLevel: 45 },
  { id: 'b_infinity', slot: 'boots', name: 'Treads of Infinity', icon: '♾️', statKey: 'hp', baseValue: 200, minLevel: 47 },

  /* -------------------------------------------------------------- trinket -- */
  { id: 't_charm', slot: 'trinket', name: 'Lucky Charm', icon: '🍀', statKey: 'goldFind', baseValue: 0.05, minLevel: 1 },
  { id: 't_fang', slot: 'trinket', name: 'Sharp Fang', icon: '🦷', statKey: 'critChance', baseValue: 0.03, minLevel: 2 },
  { id: 't_ring', slot: 'trinket', name: 'Copper Ring', icon: '💍', statKey: 'atk', baseValue: 2, minLevel: 2 },
  { id: 't_amulet', slot: 'trinket', name: 'Bone Amulet', icon: '📿', statKey: 'def', baseValue: 2, minLevel: 3 },
  { id: 't_locket', slot: 'trinket', name: 'Heart Locket', icon: '💗', statKey: 'hp', baseValue: 12, minLevel: 3 },
  { id: 't_coin', slot: 'trinket', name: 'Merchant Coin', icon: '🪙', statKey: 'goldFind', baseValue: 0.09, minLevel: 5 },
  { id: 't_wolffang', slot: 'trinket', name: 'Wolffang Pendant', icon: '🐺', statKey: 'atk', baseValue: 4, minLevel: 6, setId: 'set_wolf' },
  { id: 't_eye', slot: 'trinket', name: 'Eagle Eye', icon: '👁️', statKey: 'critChance', baseValue: 0.06, minLevel: 6 },
  { id: 't_horn', slot: 'trinket', name: "Beast's Horn", icon: '📯', statKey: 'atk', baseValue: 5, minLevel: 7 },
  { id: 't_tear', slot: 'trinket', name: 'Phoenix Tear', icon: '💧', statKey: 'hp', baseValue: 25, minLevel: 8 },
  { id: 't_crown', slot: 'trinket', name: 'Shard Crown', icon: '👑', statKey: 'goldFind', baseValue: 0.14, minLevel: 10 },
  { id: 't_orb', slot: 'trinket', name: 'Void Orb', icon: '🔮', statKey: 'critChance', baseValue: 0.1, minLevel: 11 },
  { id: 't_ironsigil', slot: 'trinket', name: 'Ironbound Sigil', icon: '⚙️', statKey: 'def', baseValue: 5, minLevel: 13, setId: 'set_iron' },
  { id: 't_relic', slot: 'trinket', name: 'Ancient Relic', icon: '🗿', statKey: 'atk', baseValue: 7, minLevel: 13 },
  { id: 't_talisman', slot: 'trinket', name: "Warlord's Talisman", icon: '🎖️', statKey: 'atk', baseValue: 9, minLevel: 15 },
  { id: 't_vial', slot: 'trinket', name: 'Vital Vial', icon: '🧪', statKey: 'hp', baseValue: 38, minLevel: 16 },
  { id: 't_hourglass', slot: 'trinket', name: 'Sandworn Hourglass', icon: '⏳', statKey: 'critChance', baseValue: 0.13, minLevel: 17 },
  { id: 't_shard', slot: 'trinket', name: 'Runic Shard', icon: '🔺', statKey: 'def', baseValue: 6, minLevel: 18 },
  { id: 't_medallion', slot: 'trinket', name: 'Gilded Medallion', icon: '🏅', statKey: 'goldFind', baseValue: 0.19, minLevel: 19 },
  { id: 't_emberseal', slot: 'trinket', name: 'Ember Seal', icon: '🔥', statKey: 'critDamage', baseValue: 0.18, minLevel: 20, setId: 'set_ember' },
  { id: 't_feather', slot: 'trinket', name: 'Griffin Feather', icon: '🪶', statKey: 'critChance', baseValue: 0.16, minLevel: 21 },
  { id: 't_soulgem', slot: 'trinket', name: 'Soul Gem', icon: '💎', statKey: 'hp', baseValue: 55, minLevel: 22 },
  { id: 't_idol', slot: 'trinket', name: 'Jade Idol', icon: '🟢', statKey: 'goldFind', baseValue: 0.24, minLevel: 23 },
  { id: 't_warband', slot: 'trinket', name: 'Warband Signet', icon: '💍', statKey: 'atk', baseValue: 14, minLevel: 25 },
  { id: 't_bastionring', slot: 'trinket', name: 'Bastion Band', icon: '⭕', statKey: 'def', baseValue: 10, minLevel: 26 },
  { id: 't_tidepearl', slot: 'trinket', name: 'Tide Pearl', icon: '🌊', statKey: 'hp', baseValue: 70, minLevel: 27, setId: 'set_tide' },
  { id: 't_venom', slot: 'trinket', name: 'Venomous Stinger', icon: '🦂', statKey: 'critChance', baseValue: 0.2, minLevel: 27 },
  { id: 't_bloodvow', slot: 'trinket', name: 'Blood Vow', icon: '🩸', statKey: 'lifesteal', baseValue: 0.08, minLevel: 28 },
  { id: 't_dragoneye', slot: 'trinket', name: "Dragon's Eye", icon: '🐉', statKey: 'atk', baseValue: 18, minLevel: 29 },
  { id: 't_hoard', slot: 'trinket', name: 'Dragon Hoard Key', icon: '🗝️', statKey: 'goldFind', baseValue: 0.31, minLevel: 31 },
  { id: 't_titanheart', slot: 'trinket', name: "Titan's Heart", icon: '❤️‍🔥', statKey: 'hp', baseValue: 80, minLevel: 32 },
  { id: 't_starcharm', slot: 'trinket', name: 'Starlit Charm', icon: '🌟', statKey: 'critChance', baseValue: 0.25, minLevel: 33 },
  { id: 't_voidcore', slot: 'trinket', name: 'Void Core', icon: '🌑', statKey: 'critChance', baseValue: 0.28, minLevel: 34, setId: 'set_void' },
  { id: 't_voidshard', slot: 'trinket', name: 'Void Shard', icon: '🕳️', statKey: 'atk', baseValue: 22, minLevel: 35 },
  { id: 't_kingsring', slot: 'trinket', name: "King's Ring", icon: '👑', statKey: 'goldFind', baseValue: 0.4, minLevel: 38 },
  { id: 't_dawnsigil', slot: 'trinket', name: 'Dawnward Sigil', icon: '🌅', statKey: 'goldFind', baseValue: 0.45, minLevel: 42, setId: 'set_dawn' }
];

/* ------------------------------------------------------------------ sets -- */

export interface ItemSet {
  id: string;
  name: string;
  icon: string;
  /** Suggested level band, used for sorting the collection view. */
  level: number;
  /** Flavour line shown on the collection card. */
  flavor: string;
}

/**
 * Relic sets. Every set base rolls one EXTRA affix on top of its rarity's
 * affix count (see `rollItem`), which is what makes hunting a set worthwhile —
 * a set rare rolls like an epic. The collection view tracks pieces owned/worn.
 */
export const ITEM_SETS: ItemSet[] = [
  { id: 'set_wolf', name: 'Wolfpack', icon: '🐺', level: 6, flavor: 'The pack runs first, and eats first.' },
  { id: 'set_iron', name: 'Ironbound', icon: '⚙️', level: 13, flavor: 'Forged shut. Nothing gets in.' },
  { id: 'set_ember', name: 'Emberforged', icon: '🔥', level: 20, flavor: 'Still warm from the forge that broke.' },
  { id: 'set_tide', name: 'Tidecaller', icon: '🌊', level: 27, flavor: 'The sea answers those who ask twice.' },
  { id: 'set_void', name: 'Voidtouched', icon: '🌑', level: 34, flavor: 'It remembers being nothing.' },
  { id: 'set_dawn', name: 'Dawnward', icon: '🌅', level: 42, flavor: 'The last light, worn as armour.' }
];

export function setById(id: string | undefined): ItemSet | null {
  if (!id) return null;
  return ITEM_SETS.find(s => s.id === id) ?? null;
}

export function setPieces(setId: string): BaseItem[] {
  return BASE_ITEMS.filter(b => b.setId === setId);
}

/* --------------------------------------------------------------- indexes -- */

const BY_ID = new Map<string, BaseItem>(BASE_ITEMS.map(b => [b.id, b]));

export function baseItemById(id: string): BaseItem | undefined {
  return BY_ID.get(id);
}

const BY_SLOT = new Map<EquipSlot, BaseItem[]>();
for (const base of BASE_ITEMS) {
  const list = BY_SLOT.get(base.slot);
  if (list) list.push(base);
  else BY_SLOT.set(base.slot, [base]);
}

export function basesForSlot(slot: EquipSlot): BaseItem[] {
  return BY_SLOT.get(slot) ?? [];
}

/** Human label for a weapon/offhand ability id, for tooltips. */
export const ABILITY_LABELS: Record<string, string> = {
  cleave: 'Cleave',
  drain: 'Soul Drain',
  bash: 'Bash',
  pierce: 'Pierce',
  backstab: 'Backstab',
  volley: 'Volley',
  fireball: 'Fireball',
  hex: 'Hex',
  flurry: 'Flurry',
  execute: 'Execute',
  bulwark: 'Bulwark',
  frostbolt: 'Frostbolt',
  mend: 'Mend'
};
