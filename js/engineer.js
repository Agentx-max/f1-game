// Race engineer: watches the car and the race and decides when the team talks to you.
// Also simulates the things they talk about: tyre + brake temperatures, fuel, front wing damage.
export class Engineer {
  constructor(radio) {
    this.radio = radio;
  }

  reset(race, track) {
    const laps = Number.isFinite(race.laps) ? race.laps : 0;
    this.on = race.mode === 'race';
    this.L = track.length;
    this.tyreT = 85; this.brakeT = 420; // °C
    this.tyreHot = false; this.brakeHot = false;
    // fuel is measured in "laps": the car carries just enough for the distance, so driving style matters
    this.fuel = laps ? laps * 1.0 + 0.12 : 0;
    this.burnAvg = 0.95; this.fuelState = 'ok'; // ok | save | critical
    this.lapDist = 0; this.lapBurn = 0;
    this.damage = 0;
    this.saidWear = false; this.saidGood = false; this.saidBox = false; this.saidHard = false;
    this.inPit = false; this.hadStop = false; this.lastSector = 0;
    this.weatherSaid = {};
  }

  // effects of the simulation on the player's car
  powerMul() { return this.fuel <= 0 && this.on ? 0.7 : this.fuelState === 'critical' ? 0.97 : 1; }
  gripMul() { return 1 - this.damage * 0.11; }

  onHit(v) { // wall or car impact on the player
    if (!this.on || v < 11) return;
    const was = this.damage;
    this.damage = Math.min(0.6, this.damage + (v - 9) / 45);
    if (this.damage > 0.12 && this.damage - was > 0.05) this.radio.say('damage', { priority: 2, cooldown: 60 });
  }
  onDRS() { this.radio.say('drs', { priority: 1, cooldown: 90 }); }
  onLap(lapNow, race) {
    if (!this.on) return;
    if (lapNow === 1) this.radio.say('lap1', { priority: 1, cooldown: 999 });
    if (lapNow === race.laps - 1 && race.laps > 1) this.radio.say('finalLap', { priority: 3, cooldown: 999 });
    // fuel: average burn over complete laps -> projection to the flag
    if (this.lapDist > this.L * 0.8) this.burnAvg = this.burnAvg * 0.5 + (this.lapBurn / (this.lapDist / this.L)) * 0.5;
    this.lapDist = 0; this.lapBurn = 0;
    const left = race.laps - lapNow;
    if (left <= 0) return;
    const margin = this.fuel - left * this.burnAvg;
    if (margin < -0.22) { if (this.fuelState !== 'critical') this.radio.say('fuelCritical', { priority: 3, cooldown: 60 }); this.fuelState = 'critical'; }
    else if (margin < 0) { if (this.fuelState === 'ok') this.radio.say('fuelSave', { priority: 2, cooldown: 60 }); this.fuelState = this.fuelState === 'critical' ? 'critical' : 'save'; }
    else if (margin > 0.04 && this.fuelState !== 'ok') { this.radio.say('fuelOk', { priority: 2, cooldown: 30 }); this.fuelState = 'ok'; }
    // healthy tyres early in the race
    if (lapNow === 2 && !this.saidGood && this.wear < 0.2 && !this.tyreHot) { this.saidGood = true; this.radio.say('tyreGood', { priority: 1 }); }
  }
  onPitEntry() { this.radio.say('pitEntry', { priority: 3, cooldown: 30 }); }
  onPitExit() { this.radio.say('pitExit', { priority: 3, cooldown: 30 }); }
  onPitStop() { // fresh tyres, new front wing, cool brakes
    this.damage = 0; this.tyreT = 75; this.saidWear = false; this.saidBox = false; this.saidHard = false; this.hadStop = true;
  }
  onSector(idx, lowGrip) { if (this.on && idx === 2 && lowGrip) this.radio.say('lowGrip', { priority: 1, cooldown: 150 }); }
  onWeather(kind) { if (!this.weatherSaid[kind]) { this.weatherSaid[kind] = true; this.radio.say(kind, { priority: 2, cooldown: 999 }); } }

  // every frame (player car only). Returns true when the team wants the driver to box.
  update(dt, pl, race, { onBox }) {
    if (!this.on || !race.started || pl.finished) return;
    const p = pl.phys, speed = Math.abs(p.u);
    this.wear = pl.wear;
    // --- tyre temperature: heats with sliding and cornering load, cools with airflow
    const slide = Math.abs(p.slipF) * 1.4 + Math.abs(p.slipR) + p.lock * 0.5 + p.spin * 0.6;
    const lat = Math.abs(p.ay || 0) / 9.81;
    this.tyreT += (slide * 260 + lat * 9 - (this.tyreT - 80) * (0.05 + speed * 0.0012)) * dt;
    if (!this.tyreHot && this.tyreT > 118) { this.tyreHot = true; this.radio.say('tyreTemp', { priority: 2, cooldown: 70 }); }
    if (this.tyreHot && this.tyreT < 104) this.tyreHot = false;
    // --- brake temperature: heavy braking from high speed, cooled by speed (air through the ducts)
    this.brakeT += (p.brake * speed * speed * 0.055 - (this.brakeT - 380) * (0.18 + speed * 0.004)) * dt;
    if (!this.brakeHot && this.brakeT > 1050) { this.brakeHot = true; this.radio.say('brakeTemp', { priority: 2, cooldown: 70 }); }
    if (this.brakeHot && this.brakeT < 850) this.brakeHot = false;
    // --- fuel: burned per metre, more at full throttle and with ERS deployment
    if (this.fuel > 0) {
      const ds = speed * dt;
      const burn = ds / this.L * (0.55 + 0.55 * p.throttle + (p.ersDeploying ? 0.08 : 0));
      this.fuel = Math.max(0, this.fuel - burn);
      this.lapDist += ds; this.lapBurn += burn;
    }
    // --- tyres: degradation warning, then the box call at 60 %
    if (!this.saidWear && pl.wear > 0.3 && pl.wear < 0.4) { this.saidWear = true; this.radio.say('tyreWear', { priority: 2 }); }
    const lapsLeft = race.laps - Math.floor(pl.totalDist / this.L);
    if (!this.saidBox && pl.wear >= 0.4 && lapsLeft >= 1 && !race.pitRequested && !race.crew) {
      this.saidBox = true;
      this.radio.say('box', { priority: 3, cooldown: 20 });
      onBox();
      this.boxAt = pl.totalDist;
    }
    // on the way to the pit: once we are well into the lap after the call
    if (this.saidBox && !this.saidHard && race.pitRequested && pl.totalDist - this.boxAt > Math.min(700, this.L * 0.3)) {
      this.saidHard = true; this.radio.say('hardBest', { priority: 2, cooldown: 30 });
    }
  }

  // HUD extras (shown on the dash)
  status() { return { fuel: this.fuel, fuelState: this.fuelState, tyreT: this.tyreT, brakeT: this.brakeT, damage: this.damage }; }
}
