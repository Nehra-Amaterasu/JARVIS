# Wall box power: a 5 V 0.75 A charger, an ESP32-S3 and six relays

## 2026-11-06: sourced numbers

**Question.** The wall box runs an ESP32-S3 dev board (Wi-Fi STA, TX power 15 dBm, 200 pings/s for CSI) and six SRD-05VDC-SL-C relays on blue 2-channel opto modules, all from one 5 V 0.75 A phone charger. The firmware sees brownout resets when relays switch. What do the datasheets say about the budget, and what are the fixes worth trying?

Legend: **[src]** = read in a primary document this session. **[est]** = my estimate, reasoning given. **[unverified]** = a figure I could not open at its source.

### Short answer

- The 3.3 V rail is not what browns out first. The brownout threshold is about 2.44 V [src], while the LDO keeps 3.3 V until its input falls to roughly 3.6 V at 0.5 A [src+est]. A reset therefore means the 5 V node collapsed below about 2.7 V, not just sagged. The likely cause is the charger hitting its current limit (or hiccup) when six coils plus the radio load it together. [est]
- Budget: six coils are 428 mA by themselves [src], the ESP32-S3 adds about 0.12 A average and 0.25 A peak [est], so the box needs roughly 0.55 to 0.7 A at 5 V against a 0.75 A label. That leaves almost no margin once cable drop, a warm coil and the charger's real current limit are counted. [est]
- The cheapest robust fixes, in order: (1) PWM-hold the coils after pull-in, which cuts steady relay current by about 75 % [est from src]; (2) stagger relay switching by 50 to 100 ms so only one coil is in pull-in at a time; (3) a 1000 to 2200 uF bulk capacitor behind a Schottky diode feeding the ESP; (4) a stronger 5 V supply (2 A) and a short thick cable.

---

### 1. ESP32-S3 current

**Datasheet Table 5-7 (Wi-Fi 2.4 GHz, active mode), v2.2** [src]. Conditions: 3.3 V supply, 25 C, TX rated at 100 % duty cycle, RX with peripherals off and CPU idle.

| Mode | Peak current |
|---|---|
| TX 802.11b, 1 Mbps, 21 dBm | 340 mA |
| TX 802.11g, 54 Mbps, 19 dBm | 291 mA |
| TX 802.11n HT20, MCS7, 18.5 dBm | 283 mA |
| TX 802.11n HT40, MCS7, 18 dBm | 286 mA |
| RX 802.11b/g/n HT20 | 88 mA |
| RX 802.11n HT40 | 91 mA |

- Source: [ESP32-S3 datasheet v2.2, Section 5.6.1](https://documentation.espressif.com/esp32-s3_datasheet_en.pdf). Mirrored in text by [Deneyap power page](https://deneyapkart.org/en/docs/guc-tuketimi-esp32-s3).
- The datasheet has no current row at 15 dBm. Its supply table asks for 3.0 to 3.6 V on VDD3P3 and a supply able to give at least 0.5 A cumulative (Table 5-2, same PDF).
- 5 V side: the dev board regulator is linear (see section 4), so the 5 V current equals the 3.3 V current plus about 0.1 mA of ground-pin current. [src: [SGM2212 datasheet, July 2023](https://www.endrich.com/Datenbl%C3%A4tter/Aktive%20Komponenten/1690103353.pdf)] The USB-UART chip and power LED add a few mA to tens of mA. [est]

**How TX current scales from about 19 to 15 dBm.** I found no Espressif or forum table with mA per dBm for the S3. The API sets power in 0.25 dBm steps, 8 to 84, which is 2 to 20 dBm ([esp_wifi_set_max_tx_power](https://sourcevu.sysprogs.com/espressif/esp-idf/symbols/esp_wifi_set_max_tx_power)); 15 dBm is the value 60 [src]. Estimate:

- Output power: 19 dBm = 79 mW, 15 dBm = 32 mW. [calc]
- Treat the 88 mA RX figure as the fixed part (digital plus receive chain), leaving about 203 mA (291 - 88) for the PA stage at 19 dBm.
- If PA current goes with the output amplitude (square root of power, a linear class-AB PA): 203 x sqrt(32/79) = 129 mA, so TX is about 217 mA.
- If it goes straight with power: 203 x 32/79 = 82 mA, so TX is about 170 mA.
- **Estimate: TX at 15 dBm is about 170 to 215 mA, use 200 mA.** Reasoning above; measure it with a shunt to replace this.

**Airtime at 200 pings/s** (estimate; frame sizes from standard 802.11 arithmetic, 56-byte ICMP payload = 84 B IP packet, plus 8 B LLC/SNAP, 26 B QoS MAC header, 16 B CCMP, 4 B FCS, about 138 B MPDU):

| Rate | Request frame | ACK for the reply (14 B at 24 Mbps) | ESP TX airtime per ping | Duty at 200/s |
|---|---|---|---|---|
| 54 Mbps OFDM (good link) | about 44 us | about 28 us | about 72 us | 1.4 % |
| 6 Mbps OFDM | about 210 us | about 28 us | about 240 us | 4.8 % |
| 1 Mbps DSSS (worst case) | about 1.3 ms | about 28 us | about 1.3 ms | 26 % |

- A good link at 3 m should sit near the first row. Retries (a lost frame sent again) multiply this.
- **Average current [est]:** radio listening continuously (CSI needs modem sleep off) at about 88 mA, plus CPU, lwIP and the board at about 20 to 40 mA, so a baseline of about 110 to 130 mA. TX adds (200 - 90) mA x 1.4 % = about 1.5 mA at a good rate, up to about 30 mA at 1 Mbps. **Average about 0.12 A, 0.15 A in the bad case.**
- **Peak [est]:** about 200 mA radio plus 40 mA CPU/board = **about 0.25 A for 50 to 300 us bursts**, rising to 0.3 A or more if the link falls back to 1 Mbps DSSS at 19 dBm-class power. Individual bursts are far too short to matter to a bulk capacitor; the average and the relay steps are what load the charger.

### 2. SRD-05VDC-SL-C (Songle)

| Parameter | Value | Source |
|---|---|---|
| Coil power | 0.36 W | [src](https://www.datasheetcafe.com/srd-05vdc-sl-c-datasheet-pdf/) |
| Coil resistance | 70 ohm (listings say 70 to 80 ohm) | [LCSC](https://lcsc.com/product-detail/Power-Relays_Ningbo-Songle-Relay-SRD-05VDC-SL-C_C35449.html), [Littlebird](https://littlebirdelectronics.com.au/products/srd-5vdc-sl-c-relay-t73-5v-5pin) |
| Nominal coil current | about 71.4 mA (5 V / 70 ohm) | [LCSC](https://www.lcsc.com/product-detail/_Ningbo-Songle-Relay-_C35449.html), [Electrokit](https://www.electrokit.com/en/rela-srd-1-pol-vaxlande-5v) |
| Operate time | 10 ms max | [datasheetcafe](https://www.datasheetcafe.com/srd-05vdc-sl-c-datasheet-pdf/) |
| Release time | 5 ms max (LCSC lists 10 ms; sources conflict) | same and [LCSC](https://www.lcsc.com/product-detail/_Ningbo-Songle-Relay-_C35449.html) |
| Pick-up (must-operate) | 75 % of rated = 3.75 V, from the SRD-family datasheet | [src, Farnell SRD datasheet](https://www.farnell.com/datasheets/2044296.pdf) |
| Drop-out (release) | 5 % of rated = 0.25 V in that family datasheet | same |
| Max allowable coil voltage | 7.8 V (130 % band) in that family datasheet | same |

- **Caveat on the last three rows.** The Farnell sheet is the generic "SRD" family (5 V coil listed at 55 ohm / 0.45 W, operate 8 ms, release 5 ms), not the Songle SL-C part, whose own sheet I could not open. The pick-up percentage (75 %) is the usual figure for this relay family and I carry it over; treat the drop-out as 5 to 10 % [unverified for SL-C]. The coil current and resistance in the table above are the SL-C figures.
- **Six coils at 5 V, 20 C:** 6 x 71.4 mA = **428 mA** [calc from src]. Coil resistance rises about 0.39 %/K for copper [est, standard], so a warm coil (+40 K) draws about 14 % less.
- **Module extras [est]:** each channel has an input resistor into the PC817 LED (about 2 to 5 mA from the logic side when on) and a relay-on LED with its resistor (about 3 mA at 5 V, 1 kohm-class). I did not find a measured figure for this exact blue module; allow **5 to 10 mA per energised channel** on top of the coil. Six on: about 30 to 60 mA extra.
- **Coil inductance: no source found.** Songle publishes none and no measurement turned up. Estimate: operate time is about 10 ms, which is several electrical time constants plus armature travel, so tau = L/R of about 2 to 5 ms, meaning L of roughly 0.15 to 0.35 H with the armature open. [est, measure with an LCR meter to replace it]
- **Inrush on a DC coil:** none beyond steady state. An inductor limits the rise: current climbs exponentially to V/R (71.4 mA) with time constant L/R, so cold-start peak = V/R, not a multiple of it. Real current can show a small dip as the armature closes (inductance rises). The "inrush" at the supply comes from six coils pulled in together (428 mA step), plus the charger's output capacitor and the module LEDs. [est from standard inductor behaviour]

### 3. PWM coil-hold ("economizer") through the module IN pin

**What the vendors say.**

| Source | Pull-in | Hold | Frequency |
|---|---|---|---|
| [Panasonic, three methods](https://na.industrial.panasonic.com/blog/three-methods-reducing-coil-holding-voltage) [src] | 100 % duty for at least 0.1 s (PWM/MOSFET method); or about 130 % voltage for at least 50 ms (CR method) | 50 % duty (PWM); about 50 % voltage (resistor method) | 20 to 100 kHz recommended, with a MOSFET driving the coil directly |
| [TE Kilovac note](https://mail.flamecorp.com/PDF/TE-Connectivity/Kilovac/Application%20Notes%20on%20Coil%20Power%20Economizing%20using%20PWM%20Circuits.pdf) [src via search summary] | full voltage first | duty (%) = Ihold x Rcoil / Vsource x 100; confirm minimum hold current per part | high enough that coil current ripple is small |
| [Omron low-power drive note](https://components.omron.com/us-en/technical-support/application-note/relays/low-power-consumption-circuit-design) | not read (HTTP 403) | | |

- TE's warning [src]: any coil-power reduction lowers the armature holding force, so shock and vibration tolerance drops.
- Panasonic also says each user must verify the circuit; its article does not mention freewheeling diodes or release time.

**PC817 speed.**
- Sharp-style datasheet condition (VCE 2 V, IC 2 mA, load 100 ohm): tr 4 us typ, tf 3 us typ, 18 us max [src: [KTP PC817](https://atta.szlcsc.com/upload/public/pdf/source/20250818/98376C06E0373A46BEA74B3916F7F17D.pdf)]. Another vendor lists 6 us and 5 us [src: [MSKSEMI via LCSC](https://www.lcsc.com/product-detail/C7472816.html)].
- The Sharp "response time vs load resistance" curve exists but I could not read plotted values ([Sharp datasheet copy](https://manualmachine.com/sharp/pc827/4267696-datasheet)). Phototransistor switching slows roughly in proportion to the load resistor: **estimate** tens of microseconds at a 1 kohm pull-up (typical on these modules, base of the driver transistor behind it) and a few hundred microseconds at 10 kohm. [est]
- **Max usable PWM frequency [est]:** keep edges under about 10 % of a period. With about 30 to 50 us edges that means a period of at least 300 to 500 us, so **2 to 3 kHz is the practical ceiling, 1 kHz is comfortable**. Panasonic's 20 kHz is for a MOSFET gate, not a PC817 path. A 20 kHz signal through this module would be mostly edge and the real duty would drift from the set value.
- **Ripple at 1 kHz [est]:** with L about 0.2 H, 5 V, D = 0.5: dI = V x D x (1 - D) / (L x f) = 5 x 0.25 / (0.2 x 1000) = about 6 mA on an average of about 36 mA (17 %). Fine. At 500 Hz the ripple doubles to 12 mA (still above any plausible drop-out current).

**Does the module's flyback diode make freewheeling hold work?** Yes. The coil sees a diode across it (the module's flyback diode), so when the transistor switches off the coil current recirculates through the diode and decays slowly instead of dropping to zero. The average coil current then equals D x V / R. [calc]
- At D = 0.5: coil current about 36 mA (half of 71.4 mA), coil heat falls to 25 %.
- The **supply** only supplies current during the ON part, so supply current = D x I_coil = 0.5 x 36 = **about 18 mA per relay instead of 71 mA** (a 75 % cut). Six held coils: about 107 mA instead of 428 mA. [calc]
- Side effect [est]: the diode also slows release (a diode-clamped coil releases slower than an undamped one), so release time after turning PWM off grows from about 5 ms to maybe 10 to 20 ms. Fine for lights and fans.

**Hold level.** App notes (Panasonic, see above) put hold at about 50 %. Pick-up needs 75 % (3.75 V), so pull-in must be at full duty (100 %) for at least 100 ms [src], and the hold level must stay far above drop-out (5 to 10 %). A 40 to 60 % hold band is the safe range; I would pick 55 % and test on the bench at the lowest supply voltage the box will see. [est]

**Audible buzz and risks.**
- Below about 15 to 20 kHz the armature and core can hum or whine at the PWM frequency or its subharmonics; a forum reports needing to raise 500 Hz PWM to 2 kHz to cut ripple and noise ([All About Circuits thread](https://forum.allaboutcircuits.com/threads/pwm-for-efficient-relay-circuit-some-questions.129746/)) [src via search summary, forum-grade]. With the PC817 ceiling of 2 to 3 kHz some hum is likely audible, particularly at 1 kHz. Test one relay in a quiet room before committing.
- Reduced holding force means a bump or shake can drop the relay; the contacts then arc or chatter. Check with a load.
- If the ESP resets, PWM stops and every held relay releases within the release time. With active-low modules, a floating pin state can also energise a channel at boot; set the pins as outputs high before enabling them. [est]
- Do not drive IN pins directly from the S3 GPIO without the module's 3.3 V logic check; many blue modules want 5 V on VCC for the opto LED, which is another reason to keep the jumper (section 8) in place unless the coil supply is separate.
- A PWM duty edge case: the one hold pulse after pull-in should not exceed the supply budget; stagger channels by 50 to 100 ms.

### 4. Brownout detector and the dev board LDO

**Brownout thresholds, ESP-IDF v5.4, esp32s3 Kconfig** [src: [`Kconfig.system`](https://raw.githubusercontent.com/espressif/esp-idf/release/v5.4/components/esp_system/port/soc/esp32s3/Kconfig.system)]. The file says the detector resets the chip "when the supply voltage is approximately below this level", and that the voltages "are estimates" with chip-to-chip variation.

| Option | Level |
|---|---|
| `ESP_BROWNOUT_DET_LVL_SEL_7` (default) | 2.44 V |
| `..._6` | 2.56 V |
| `..._5` | 2.67 V |
| `..._4` | 2.84 V |
| `..._3` | 2.98 V |
| `..._2` | 3.19 V |
| `..._1` | 3.30 V |

- Which rail it watches: the Kconfig says only "the supply voltage"; the datasheet gives the analog domains as VDDA and VDD3P3 [src, Table 5-2], which on this board are the 3.3 V net. I did not find a primary statement of exactly which internal node the comparator reads, so the claim is "the chip's 3.3 V supply, not the 5 V input" [unverified detail].
- The default is the lowest level, 2.44 V. Raising it to a higher level (for example 2.98 V) would make the chip reset earlier, not later; the setting to ignore sags is the default or `ESP_BROWNOUT_DET=n`, which I would not use: the datasheet's recommended minimum is 3.0 V.

**LDO on the ESP32-S3-DevKitC-1 v1.1** [src: Espressif schematic [SCH_ESP32-S3-DevKitC-1_V1.1_20221130.pdf](https://dl.espressif.com/dl/schematics/SCH_ESP32-S3-DevKitC-1_V1.1_20221130.pdf)]: **U2 = SGM2212-3.3XKC3G/TR**, 800 mA, SOT-223-class. Also on the schematic: 1N5819HW-7-F Schottky diodes (D1, D7) on the USB VBUS feeds.

**SGM2212-3.3 dropout** [src: [SGM2212 datasheet, July 2023](https://www.endrich.com/Datenbl%C3%A4tter/Aktive%20Komponenten/1690103353.pdf), electrical table, definition: input-to-output difference when output falls to 95 % of 3.3 V]:

| Load | Typ at 25 C | Max |
|---|---|---|
| 100 mA | 50 mV | 60 mV |
| 500 mA | 240 mV | 280 mV (380 mV over temperature) |
| 800 mA | 390 mV | 450 mV (610 mV over temperature) |

- Current limit 810 to 1100 mA, short-circuit limit 360 mA (same table).
- **Minimum 5 V-pin voltage that keeps 3.3 V up at 0.25 A [est from table]:** the LDO regulates until Vin is about Vout + dropout. At 0.25 A the drop is about 150 mV, so **about 3.45 V** holds 3.3 V; at 0.5 A about 3.6 V. The chip itself only needs 3.0 V (datasheet recommended minimum), so the 3.3 V net stays above 3.0 V down to a 5 V node of about 3.2 to 3.3 V. The brownout at 2.44 V therefore needs the 5 V node to fall below about 2.7 V, a collapse, not a ripple.
- If the board is fed on the 5 V pin, that pin sits **ahead of the LDO** (net VCC_5V in the schematic), so it bypasses the USB-side Schottky. Keep the external feed diode in mind (section 5).

### 5. Diode feed and hold-up capacitor math

**Forward drop.**
- 1N4007 (Vishay 1N4001-1N4007 datasheet, [88503](https://www.vishay.com/docs/88503/1n4001.pdf)) [src]: **1.1 V maximum at 1 A**. Typical at lower current is lower; read from the VF-IF curve, **about 0.85 to 0.9 V at 0.5 A, about 0.75 V at 0.1 A** [est from curve shape].
- 1N5819 (Vishay 1N5817/18/19 datasheet, [88525](https://www.vishay.com/docs/88525/1n5817.pdf)) [src]: **0.60 V maximum at 1 A**, 0.75 V at 3.1 A. Typical at 0.1 to 0.5 A is **about 0.30 to 0.45 V** [est from curve shape, 1N5819 reads lower than the max].
- **Conclusion:** a 1N5819 (or any 1 A Schottky) costs 0.3 to 0.45 V; a 1N4007 costs 0.75 to 0.9 V. At 0.5 A the charger-to-ESP feed loses about 0.2 W in the Schottky versus 0.45 W in a 1N4007. The 1N4007 also slows turn-on. [est]

**Hold-up capacitor, C = I x dt / dV.** Load step 0.35 A (ESP peak plus a relay pull-in) with the charger unable to answer for dt. dV is the droop.

| C | dV for 1 ms | dV for 3 ms | dV for 5 ms |
|---|---|---|---|
| 470 uF | 0.74 V | 2.23 V | 3.72 V |
| 1000 uF | 0.35 V | 1.05 V | 1.75 V |
| 2200 uF | 0.16 V | 0.48 V | 0.80 V |

- Example: 1000 uF for 5 ms at 0.35 A: dV = 0.35 x 0.005 / 0.001 = 1.75 V. [calc]
- Reverse: to hold droop under 0.5 V for 3 ms you need C = 0.35 x 0.003 / 0.5 = 2100 uF. [calc]
- **ESR adds an instant drop** of I x ESR. Panasonic EEU-FR 1000 uF/10 V radial: 41 mohm (8 mm can) to 28 mohm (10 mm can) impedance at 100 kHz ([DigiKey EEU-FR1A102L](https://www.digikey.jp/en/products/detail/panasonic-industry/EEU-FR1A102L/2433512), [EEU-FR1A102](https://www.digikey.it/en/products/detail/panasonic-electronic-components/EEU-FR1A102/9921022)) [src, retailer listing]. Generic non-low-ESR 470 uF caps are often 0.2 to 0.5 ohm at 100 kHz [est]. At 0.35 A: FR 1000 uF = 14 mV, generic = 70 to 175 mV.
- A bulk cap only covers a few milliseconds. A relay pull-in step lasts up to 10 ms (operate time) and the coil current stays on, so a capacitor helps with the ESP bursts and the first few ms of the step but cannot fix a charger that cannot hold the average.
- Place the diode between charger and cap, then cap, then the ESP 5 V pin and relay coil supply, so the cap cannot be discharged back into the charger. Add an inrush check: a 2200 uF cap on a current-limited 0.75 A charger charges in 2200 uF x 5 V / 0.75 A = about 15 ms at power-up, fine. [calc]

### 6. Phone-charger behaviour when overloaded

No source found for a specific 5 V 0.75 A charger. Generic behaviour from power-supply references:
- **Constant-current limit:** output current is capped and the voltage falls as the load tries to take more ([Traco, over-current protection](https://tracopower.com/node/253)).
- **Foldback:** the allowed current drops as the output voltage drops, so a charger that goes over its limit can fall further and may latch low until the load is removed ([TI SNVA604](https://ti.com/lit/pdf/snva604)).
- **Hiccup:** the controller switches off, then retries on a timer, a pulsing output that repeats until the overload ends; high start-up inrush (for example big capacitors) can trigger it ([Traco](https://tracopower.com/node/253), [ST AN1215](https://www.st.com/resource/en/application_note/an1215-how-to-handle-short-circuit-conditions-with-sts-advanced-pwm-controllers-stmicroelectronics.pdf), [Active-Semi ACT337 flyback charger](https://ko.datasheetq.com/pdf-html/260253/ACTIVE-SEMI/6page/ACT337.html)) [src].
- **For this box [est]:** a 0.75 A label means about 3.75 W; cheap flybacks typically start current-limiting at 100 to 130 % of the label (about 0.75 to 1 A), and their output capacitor is small (tens to a few hundred uF). A 0.68 A step (six coils plus radio) therefore sits at the edge. With a 5 V node falling slowly, the ESP's 3.3 V net stays valid down to about 3.3 V on the 5 V pin, so a reset implies the output collapsed hard, consistent with foldback or hiccup, not a plain droop. Logging the 5 V pin on a scope or a logic analyzer on a spare ADC pin during a six-relay switch would settle it.
- The charger's ripple and 5 % tolerance, plus 0.25 V of cable drop (section 7), can leave only 4.5 to 4.7 V at the box. [est]

### 7. Wiring losses

| Item | Value | Source |
|---|---|---|
| Copper wire 22 AWG | 52.96 mohm/m | [src, Wikipedia AWG](https://en.wikipedia.org/wiki/American_wire_gauge) |
| 24 AWG | 84.22 mohm/m | same |
| 26 AWG | 133.9 mohm/m | same |
| 28 AWG | 212.9 mohm/m | same |
| Breadboard contact, new | about 10 mohm per contact, plus about 11 mohm per inch of rail | [Digi-Key forum measurement](https://forum.digikey.com/t/what-is-the-maximum-current-for-a-solderless-breadboard/36612) [src] |
| Breadboard contact, older | about 50 mohm per contact | same |
| Breadboard, cheap steel contacts | several ohms reported | [Digilent forum](https://forum.digilent.com/topic/20220-what-is-the-contact-resistance-of-solderless-breadboards/) [src] |
| Breadboard measured adding | about 0.4 ohm in one thread | [Physics Forums](https://www.physicsforums.com/posts/7289401) [src] |
| USB cable | total assembly below 2 ohm; 30 mohm per contact assumed; 4.5 V at charger needed for full charge | [Gough's Lug Nut](https://goughlui.com/2014/10/01/usb-cable-resistance-why-your-phonetablet-might-be-charging-slow/) [src] |
| USB 2.0 cable drop limit | 125 mV on VBUS (plug to plug, detachable cable) | [USB 2.0 ECN](https://git.nefarius.at/nefarius/USB-Bluetooth-Specs/raw/branch/master/usb_20_0702115/USB%202.0%20ECN%20VBUS%20Max%20Limit.pdf) [src via search summary] |

Resulting drops (round trip = 2 x length; I = 0.5 to 0.8 A) [calc]:
- 1 m of 24 AWG supply pair: 2 x 0.084 = 0.168 ohm, drop 84 mV at 0.5 A, 135 mV at 0.8 A.
- 1 m of 28 AWG: 2 x 0.213 = 0.426 ohm, drop 0.21 V at 0.5 A, 0.34 V at 0.8 A.
- 3 m of 28 AWG USB cable: 1.28 ohm, 0.64 V at 0.5 A, 1.0 V at 0.8 A.
- Each breadboard contact in the 5 V and GND path at 50 mohm: say 6 contacts = 0.3 ohm, 0.15 V at 0.5 A, 0.24 V at 0.8 A. One bad contact at 1 ohm costs 0.5 V at 0.5 A and 0.8 V at 0.8 A.
- **Do not carry the 428 mA coil current across a breadboard**; solder or screw-terminal the supply path. Breadboard contact ratings are typically 1 A per contact at best. [est]
- A 5 V charger that is "5 V" at its plug but delivers 4.6 V at the box leaves 0.25 V less for the LDO headroom at no cost in practice, but takes the relay pick-up margin (3.75 V) down toward its limit once the diode (0.3 to 0.9 V) is added, if the coils are fed through the same diode.

### 8. JD-VCC jumper on the blue modules

Sources agree ([Arduino forum, relay jumper isolation](https://forum.arduino.cc/t/relay-jumper-isolation/693248), [Components101, 5 V dual channel relay](https://components101.com/switches/5v-dual-channel-relay-module-pinout-features-applications-working-datasheet)) [src via search summary]:
- **Jumper in place (default):** VCC and JD-VCC are joined; the coils, driver transistors and the opto LEDs all run from the same 5 V (the one on the VCC pin). No isolation between the control side and coils; the coil current flows from the control supply.
- **Jumper removed:** feed JD-VCC and the module GND from a separate 5 V supply for the coils; keep VCC on the logic supply for the opto-LED side. For true isolation the two grounds must not be tied. The opto then switches the transistor with the opto-side supply while the coils draw from the separate one.
- **For this box:** removing the jumper and feeding JD-VCC from a second 5 V supply (a 2 A phone charger or small buck) takes the 428 mA coil load off the ESP's charger entirely. The ESP side then needs only about 0.12 A average, 0.25 A peak, easy for the 0.75 A charger. If grounds are kept common (needed so the S3 GPIO level is referenced to the module), you lose galvanic isolation but gain the supply split, which is what matters for the brownouts. [est]
- Some vendors say VCC can then be 3.3 V with a 5 V JD-VCC; this is a vendor claim for some boards, so check this module's LED resistor value before relying on it. [unverified]
- With the jumper removed and JD-VCC unpowered, the relays will not pull in even when the opto conducts. Label the wire.

### What this changed

- Replaces the loose "relay switching causes the brownout" reading with a budget: relays 428 mA [src] versus an ESP of about 120 mA average and 250 mA peak [est] against a 750 mA label, with the real failure being a charger collapse, not LDO dropout (dropout and brownout margins in sections 4 and 6 show the 3.3 V net has a lot of room).
- Ranks the fixes: PWM hold (about 75 % off steady relay current), stagger switching, a Schottky plus 1000 to 2200 uF cap, JD-VCC from a second supply, and a 2 A charger.
- Open measurements to replace estimates: TX current at 15 dBm (shunt), coil inductance (LCR meter), the 5 V pin during a six-relay switch (scope), the module's input resistor and LED current, and the PC817 edge time on this exact module.
- `docs/research/README.md` still needs its one-line entry for this file.
