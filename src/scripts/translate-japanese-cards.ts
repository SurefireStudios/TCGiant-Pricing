import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, like } from 'drizzle-orm';
import * as schema from '../db/schema';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// National Pokédex Gen 1-2 mapping by number
const POKEDEX_GEN1: Record<string, string> = {
  '001': 'Bulbasaur', '002': 'Ivysaur', '003': 'Venusaur', '004': 'Charmander', '005': 'Charmeleon',
  '006': 'Charizard', '007': 'Squirtle', '008': 'Wartortle', '009': 'Blastoise', '010': 'Caterpie',
  '011': 'Metapod', '012': 'Butterfree', '013': 'Weedle', '014': 'Kakuna', '015': 'Beedrill',
  '016': 'Pidgey', '017': 'Pidgeotto', '018': 'Pidgeot', '019': 'Rattata', '020': 'Raticate',
  '021': 'Spearow', '022': 'Fearow', '023': 'Ekans', '024': 'Arbok', '025': 'Pikachu',
  '026': 'Raichu', '027': 'Sandshrew', '028': 'Sandslash', '029': 'Nidoran F', '030': 'Nidorina',
  '031': 'Nidoqueen', '032': 'Nidoran M', '033': 'Nidorino', '034': 'Nidoking', '035': 'Clefairy',
  '036': 'Clefable', '037': 'Vulpix', '038': 'Ninetales', '039': 'Jigglypuff', '040': 'Wigglytuff',
  '041': 'Zubat', '042': 'Golbat', '043': 'Oddish', '044': 'Gloom', '045': 'Vileplume',
  '046': 'Paras', '047': 'Parasect', '048': 'Venonat', '049': 'Venomoth', '050': 'Diglett',
  '051': 'Dugtrio', '052': 'Meowth', '053': 'Persian', '054': 'Psyduck', '055': 'Golduck',
  '056': 'Mankey', '057': 'Primeape', '058': 'Growlithe', '059': 'Arcanine', '060': 'Poliwag',
  '061': 'Poliwhirl', '062': 'Poliwrath', '063': 'Abra', '064': 'Kadabra', '065': 'Alakazam',
  '066': 'Machop', '067': 'Machoke', '068': 'Machamp', '069': 'Bellsprout', '070': 'Weepinbell',
  '071': 'Victreebel', '072': 'Tentacool', '073': 'Tentacruel', '074': 'Geodude', '075': 'Graveler',
  '076': 'Golem', '077': 'Ponyta', '078': 'Rapidash', '079': 'Slowpoke', '080': 'Slowbro',
  '081': 'Magnemite', '082': 'Magneton', '083': 'Farfetchd', '084': 'Doduo', '085': 'Dodrio',
  '086': 'Seel', '087': 'Dewgong', '088': 'Grimer', '089': 'Muk', '090': 'Shellder',
  '091': 'Cloyster', '092': 'Gastly', '093': 'Haunter', '094': 'Gengar', '095': 'Onix',
  '096': 'Drowzee', '097': 'Hypno', '098': 'Krabby', '099': 'Kingler', '100': 'Voltorb',
  '101': 'Electrode', '102': 'Exeggcute', '103': 'Exeggutor', '104': 'Cubone', '105': 'Marowak',
  '106': 'Hitmonlee', '107': 'Hitmonchan', '108': 'Lickitung', '109': 'Koffing', '110': 'Weezing',
  '111': 'Rhyhorn', '112': 'Rhydon', '113': 'Chansey', '114': 'Tangela', '115': 'Kangaskhan',
  '116': 'Horsea', '117': 'Seadra', '118': 'Goldeen', '119': 'Seaking', '120': 'Staryu',
  '121': 'Starmie', '122': 'Mr Mime', '123': 'Scyther', '124': 'Jynx', '125': 'Electabuzz',
  '126': 'Magmar', '127': 'Pinsir', '128': 'Tauros', '129': 'Magikarp', '130': 'Gyarados',
  '131': 'Lapras', '132': 'Ditto', '133': 'Eevee', '134': 'Vaporeon', '135': 'Jolteon',
  '136': 'Flareon', '137': 'Porygon', '138': 'Omanyte', '139': 'Omastar', '140': 'Kabuto',
  '141': 'Kabutops', '142': 'Aerodactyl', '143': 'Snorlax', '144': 'Articuno', '145': 'Zapdos',
  '146': 'Moltres', '147': 'Dratini', '148': 'Dragonair', '149': 'Dragonite', '150': 'Mewtwo',
  '151': 'Mew'
};

const JAPANESE_SET_MAP: Record<string, string> = {
  'ja-PMCG1': 'Base Set (Japanese)',
  'ja-PMCG2': 'Jungle (Japanese)',
  'ja-PMCG3': 'Fossil (Japanese)',
  'ja-PMCG4': 'Team Rocket (Japanese)',
  'ja-PMCG5': 'Gym Heroes (Japanese)',
  'ja-PMCG6': 'Gym Challenge (Japanese)',
  'ja-neo1': 'Neo Genesis (Japanese)',
  'ja-neo2': 'Neo Discovery (Japanese)',
  'ja-neo3': 'Neo Revelation (Japanese)',
  'ja-neo4': 'Neo Destiny (Japanese)',
};

async function translate() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  console.log('🚀 Translating Japanese sets and cards to English...');

  const jpSets = await db
    .select()
    .from(schema.sets)
    .where(like(schema.sets.externalId, 'ja-%'));

  console.log(`Found ${jpSets.length} Japanese sets.`);

  let updatedSets = 0;
  let updatedCards = 0;

  for (const setItem of jpSets) {
    const englishSetName = JAPANESE_SET_MAP[setItem.externalId || ''] || `${setItem.name} (Japanese)`;
    
    // Update set name if needed
    if (setItem.name !== englishSetName) {
      await db
        .update(schema.sets)
        .set({ name: englishSetName })
        .where(eq(schema.sets.id, setItem.id));
      updatedSets++;
    }

    // Fetch cards for this set
    const setCards = await db
      .select()
      .from(schema.cards)
      .where(eq(schema.cards.setId, setItem.id));

    for (const card of setCards) {
      // Check if card name has Japanese characters
      const isJapaneseText = /[^\x00-\x7F]/.test(card.name);
      if (!isJapaneseText) continue;

      const numStr = (card.cardNumber || '').padStart(3, '0');
      let englishName = POKEDEX_GEN1[numStr];

      if (englishName) {
        englishName = `${englishName} (Japanese)`;
        await db
          .update(schema.cards)
          .set({ name: englishName })
          .where(eq(schema.cards.id, card.id));
        updatedCards++;
      } else {
        // Fallback for non-Gen1 / trainers: strip non-ascii or append (Japanese)
        const fallbackName = `Card #${card.cardNumber || card.id} (Japanese)`;
        await db
          .update(schema.cards)
          .set({ name: fallbackName })
          .where(eq(schema.cards.id, card.id));
        updatedCards++;
      }
    }
  }

  console.log(`\n🎉 Translation Complete!`);
  console.log(`- Sets Updated: ${updatedSets}`);
  console.log(`- Cards Translated: ${updatedCards}`);
}

translate().catch(console.error);
