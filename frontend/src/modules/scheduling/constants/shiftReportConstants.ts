export const SAMPLE_CALL_TYPES = [
  "Structure Fire", "Vehicle Fire", "Brush/Wildland",
  "EMS/Medical", "Motor Vehicle Accident", "Hazmat",
  "Rescue/Extrication", "Alarm Investigation",
  "Water Rescue", "Public Assist", "Other",
];

export const SAMPLE_SKILLS = [
  "SCBA donning/doffing", "Hose deployment",
  "Ladder operations", "Search and rescue",
  "Ventilation", "Radio communications",
  "Scene size-up", "Knot tying",
  "Forcible entry", "Patient assessment",
  "CPR/AED", "Vitals monitoring",
  "Apparatus check-off",
];

export const SAMPLE_TASKS = [
  "Apparatus check-off", "Station duties",
  "Equipment inventory", "Hydrant inspection",
  "Pre-plan review", "Map/district familiarization",
  "Training drill participation",
  "Report writing", "PPE inspection",
];

export const SAMPLE_APPARATUS_SKILLS: Record<string, string[]> = {
  engine: ["Pump operations", "Hose deployment", "Hydrant connection", "Drafting", "Foam operations", "Attack line advancement", "Water supply establishment", "Apparatus positioning"],
  ladder: ["Aerial operations", "Ladder placement", "Ventilation (vertical)", "Roof operations", "Forcible entry", "Ground ladder deployment", "Elevated master stream", "Building size-up"],
  ambulance: ["Patient assessment", "Vitals monitoring", "CPR/AED", "Airway management", "IV/IO access", "Splinting/immobilization", "Medication administration", "Patient packaging/transport", "12-lead ECG interpretation"],
  rescue: ["Vehicle extrication", "Confined space entry", "Rope rescue (high/low angle)", "Structural collapse operations", "Trench rescue", "Water rescue", "Stabilization techniques", "Cribbing and shoring"],
  tanker: ["Water shuttle operations", "Portable tank setup", "Drafting from portable tank", "Dump valve operations", "Tanker positioning", "Water supply calculation"],
  hazmat: ["HazMat identification (placards/SDS)", "Level A/B suit donning", "Decontamination setup", "Air monitoring", "Containment/damming", "ERG reference and zone establishment"],
  brush: ["Wildland fire line construction", "Pump and roll operations", "Foam application (Class A)", "Mop-up techniques", "Weather observation and reporting"],
  chief: ["Incident command establishment", "Resource management", "Accountability tracking", "Strategic decision-making", "Interagency coordination"],
  boat: ["Vessel operation and navigation", "Water rescue swimmer deployment", "Throw bag / reach techniques", "Towing and anchoring"],
};

export const SAMPLE_APPARATUS_TASKS: Record<string, string[]> = {
  engine: ["Pump test / pressure check", "Hose load inspection", "Nozzle and appliance check", "Tank fill verification"],
  ladder: ["Aerial function test", "Ground ladder inventory", "Hydraulic system check", "Outrigger/stabilizer inspection"],
  ambulance: ["Medication expiration check", "Monitor/defibrillator test", "Oxygen supply verification", "Stretcher and restraint check", "BLS/ALS supply restock"],
  rescue: ["Extrication tool function test", "Rope and harness inspection", "Air supply verification", "Cribbing inventory"],
  tanker: ["Tank integrity check", "Dump valve function test", "Portable tank condition check"],
  hazmat: ["Detection equipment calibration", "PPE suit integrity check", "Decon supplies inventory"],
};
