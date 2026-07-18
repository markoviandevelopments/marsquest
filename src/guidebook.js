// In-game encyclopedia content for the guidebook panel

export const GUIDE_SECTIONS = [
  {
    id: 'basics',
    title: 'Getting started',
    body: `
      <p><b>Click</b> the game to capture the mouse. <b>WASD</b> move, <b>Space</b> jump, <b>Shift</b> sprint.</p>
      <p><b>Left click</b> mines blocks or attacks chickens. <b>Right click</b> places the selected hotbar block.</p>
      <p><b>E</b> opens the inventory: assign any block from tabs into your 10 hotbar slots. <b>1–9</b> and <b>0</b> pick a slot. <b>C</b> eats cooked anacharis or cheese in Survival.</p>
      <p><b>Anacharis</b> plants in pond water and grows upward. Cook it in a <b>Furnace</b> (cobble craft) with oak log/planks fuel. Furnaces also smelt ores → ingots and sand → glass.</p>
      <p><b>Wheat</b> plants on grass (or dirt) and grows to two blocks tall. Break either stalk to collect wheat. Craft <b>3 Wheat → 1 Pretzel</b> and eat with <b>C</b>.</p>
      <p><b>Pear Gouramis</b> (male &amp; female) swim in water and keep a steady school of about 20.</p>
      <p><b>Mars Portal</b> (right-click) drops you far below Earth (y≈−200). Explore dust plains, polar ice, magma craters, basalt pillars, crystal spikes, meteor impacts, and ruined habitats. The <b>Earth Portal</b> shrine is at map center.</p>
      <p><b>Mars fauna:</b> Rock Rovers, Dust Hoppers, Crystal Crawlers — punch them for rust ore, dust, or crystals. Earth toads/chickens never go to Mars.</p>
      <p><b>T</b> opens chat. <b>Esc</b> opens this pause menu. Scroll or press <b>1–9</b> to change blocks.</p>
      <p>The world is a fixed <b>100×100</b> map. Digs, builds, toads, and time of day are saved on the server.</p>
    `,
  },
  {
    id: 'modes',
    title: 'Creative & Survival',
    body: `
      <p><b>/creative</b> — unlimited blocks, no health or hunger (default).</p>
      <p><b>/survival</b> — 10 hearts and 10 cheese hunger wedges. Inventory starts empty; mine blocks to collect them.</p>
      <p>In Survival, place only what you have. <b>Chickens</b> drop cheese; press <b>E</b> to eat (+3 hunger). Lose 1 hunger every 4 minutes. Hitting 0 hearts or 0 hunger is game over (inventory resets; world stays).</p>
      <p>Falling from a height deals heart damage.</p>
    `,
  },
  {
    id: 'blocks',
    title: 'Blocks',
    body: `
      <ul>
        <li><b>Grass / Dirt / Stone / Sand</b> — common terrain.</li>
        <li><b>Oak Log</b> — tree trunks. Craft <b>1 log → 5 planks</b>.</li>
        <li><b>Oak Planks</b> — building wood. Craft signs, torches, chests, and beds.</li>
        <li><b>Chest</b> — right-click to open. Holds up to <b>30 item types</b> with unlimited stack sizes. Contents are <b>shared by all players</b> and saved across sessions.</li>
        <li><b>Bed</b> — 1×1 block with a bed painting on each face. Right-click at night to <b>skip to morning for all players</b>.</li>
        <li><b>Code Block</b> — right-click to edit <b>Python</b>. Each face is labeled (+X/−X/+Y/−Y/+Z/−Z). Activate faces with <code>activate("+x")</code>; read neighbors with <code>read_neighbor(face)</code>; use <code>time.sleep</code>. Scripts run on the server while any player is online and halt when the world is empty.</li>
        <li><b>LED Block</b> — right-click to pick a color (default red). Lights up when an activated Code Block face touches it.</li>
        <li><b>Oak Leaves</b> — tree canopy. Decay if more than 4 blocks from any oak log. Breaking leaves may drop an <b>Oak Sapling</b>.</li>
        <li><b>Oak Sapling</b> — place on dirt/grass to grow a full oak tree immediately.</li>
        <li><b>Glass</b> — transparent building block.</li>
        <li><b>Water</b> — placeable liquid (not solid).</li>
        <li><b>Torch</b> — lights the night. Custom mesh + glow.</li>
        <li><b>Sign</b> — write a message; faces you when placed.</li>
        <li><b>Ores</b> — coal, iron, gold, diamond speckled stone underground.</li>
        <li><b>Bedrock</b> — unbreakable floor and world border.</li>
      </ul>
    `,
  },
  {
    id: 'crafting',
    title: 'Crafting',
    body: `
      <p>Open the pause menu (<b>Esc</b>) → <b>Craft</b>.</p>
      <ul>
        <li><b>1 Oak Log → 5 Oak Planks</b></li>
        <li><b>5 Oak Planks → 1 Sign</b></li>
        <li><b>5 Oak Planks → 1 Torch</b></li>
        <li><b>10 Oak Planks → 1 Chest</b></li>
        <li><b>10 Oak Planks → 1 Bed</b></li>
      </ul>
      <p>In Survival you must have the planks in your inventory. In Creative, craft freely.</p>
    `,
  },
  {
    id: 'mobs',
    title: 'Mobs',
    body: `
      <h4>Toads</h4>
      <p>Hop around the whole map. Hunger bar above their head (green→red) with a gold tick for breeding reserve.</p>
      <p>They eat red berries that spawn on grass. Low hunger → seek food. High breeding reserve → seek other ready toads and reproduce. Offspring blend parent colors (green↔brown) with mutation.</p>
      <p>Chat: <code>/summontoads</code>, <code>/toadmetincrease</code>, <code>/foodrateincrease</code>.</p>
      <h4>Chickens</h4>
      <p>White birds wandering the world. They <b>spawn and die randomly</b>, settling around ~20 birds. Left-click while looking at one to defeat it. In Survival they drop <b>cheese wedges</b> you can eat with <b>E</b>.</p>
    `,
  },
  {
    id: 'daynight',
    title: 'Day & night',
    body: `
      <p><b>5 minute day</b>, <b>3 minute night</b>. The sun and moon arc across the sky; sky color, fog, and ambient light change.</p>
      <p>Torches glow brighter at night. Type <code>/time</code> for status.</p>
      <p><b>Bed</b> (craft with 10 oak planks): right-click any time to skip to morning for <b>all players</b> — only one player needs to use the bed.</p>
    `,
  },
  {
    id: 'codeled',
    title: 'Code & LED',
    body: `
      <p><b>Code Block</b> and <b>LED Block</b> are in the creative hotbar.</p>
      <h4>Code Block</h4>
      <p>Right-click to open the Python editor. Each face is labeled on the block (+X, −X, +Y, −Y, +Z, −Z).</p>
      <ul>
        <li><code>activate("+x")</code> / <code>deactivate("+x")</code> — turn a face signal on/off</li>
        <li><code>get_face("+x")</code> — read this block's face</li>
        <li><code>read_neighbor("+x")</code> — read the Code Block face touching us on that side</li>
        <li><code>time.sleep(0.5)</code> — pause (max 60s per call)</li>
        <li><code>print("hi")</code> — system chat message</li>
      </ul>
      <p>Scripts run on the <b>server</b> as long as the block exists and <b>at least one player</b> is online. When the last player leaves, <b>all scripts halt</b>.</p>
      <h4>LED Block</h4>
      <p>Right-click to choose a color (default <b>red</b>). If any neighboring Code Block has an <b>activated face</b> touching the LED, it lights up in that color.</p>
    `,
  },
  {
    id: 'commands',
    title: 'Chat commands',
    body: `
      <ul>
        <li><code>/help</code> — list commands</li>
        <li><code>/survival</code> / <code>/creative</code> — game modes</li>
        <li><code>/save</code> — force world save</li>
        <li><code>/summontoads</code> / <code>/summontoads50</code> — spawn toads</li>
        <li><code>/cleartoads</code> — remove toads & berries</li>
        <li><code>/foodrateincrease</code> / <code>/foodratedecrease</code></li>
        <li><code>/toadmetincrease</code> / <code>/toadmetdecrease</code></li>
        <li><code>/time</code> — day/night</li>
      </ul>
    `,
  },
  {
    id: 'multiplayer',
    title: 'Multiplayer & saves',
    body: `
      <p>Share the same URL. Each player gets a random name. Digs, builds, signs, toads, and time sync and save on the server so you can leave and rejoin later.</p>
      <p>Use <b>Save</b> in the pause menu or <code>/save</code> after big builds.</p>
    `,
  },
];
