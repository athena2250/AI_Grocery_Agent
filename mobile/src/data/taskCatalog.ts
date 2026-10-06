import type { Section } from '../state/tasks';

/**
 * Common household tasks, like the grocery products: a name, its section, and
 * the words families use for it. An entry only says what the task *is* — it
 * never fills in who, when or how much. `implied` holds a field the name itself
 * already answers ("current bill" is the electricity bill), nothing more.
 */
export interface CatalogTask {
  id: string;
  name: string;
  section: Section;
  aliases: string[];
  implied?: Record<string, string>;
}

export const TASK_CATALOG: CatalogTask[] = [
  // Home Repair
  { id: 't_plumber', name: 'Call the plumber', section: 'Home Repair', aliases: ['plumber', 'tap leaking', 'leaking tap', 'tap leak', 'pipe leak', 'leaking pipe', 'drain blocked', 'blocked drain', 'sink blocked', 'flush not working'] },
  { id: 't_electrician', name: 'Call the electrician', section: 'Home Repair', aliases: ['electrician', 'fuse', 'switch not working', 'wiring', 'short circuit', 'power socket'] },
  { id: 't_carpenter', name: 'Call the carpenter', section: 'Home Repair', aliases: ['carpenter', 'door repair', 'cupboard repair', 'door not closing', 'hinge'] },
  { id: 't_fan', name: 'Fix the fan', section: 'Home Repair', aliases: ['fan not working', 'fan repair', 'fix the fan', 'fan making noise'] },
  { id: 't_geyser', name: 'Geyser repair', section: 'Home Repair', aliases: ['geyser', 'water heater', 'no hot water'] },
  { id: 't_ac_repair', name: 'AC repair', section: 'Home Repair', aliases: ['ac', 'ac not cooling', 'ac repair', 'ac leaking', 'air conditioner'] },
  { id: 't_fridge', name: 'Fridge repair', section: 'Home Repair', aliases: ['fridge', 'fridge not cooling', 'fridge repair', 'refrigerator'] },
  { id: 't_washer', name: 'Washing machine repair', section: 'Home Repair', aliases: ['washing machine', 'washing machine repair'] },
  { id: 't_bulb', name: 'Change the bulb', section: 'Home Repair', aliases: ['bulb', 'tube light', 'tubelight', 'light not working', 'change the bulb'] },

  // Maintenance
  { id: 't_ac_service', name: 'AC service', section: 'Maintenance', aliases: ['ac', 'ac service', 'ac servicing', 'air conditioner'] },
  { id: 't_ro', name: 'RO / water filter service', section: 'Maintenance', aliases: ['ro', 'ro service', 'water filter', 'water purifier', 'ro filter', 'aquaguard'] },
  { id: 't_pest', name: 'Pest control', section: 'Maintenance', aliases: ['pest control', 'cockroach', 'cockroaches', 'termite', 'termites', 'ants'] },
  { id: 't_tank', name: 'Water tank cleaning', section: 'Maintenance', aliases: ['tank cleaning', 'water tank', 'clean the tank', 'sump cleaning'] },
  { id: 't_car', name: 'Car service', section: 'Maintenance', aliases: ['car service', 'car servicing', 'car wash'] },
  { id: 't_bike', name: 'Bike service', section: 'Maintenance', aliases: ['bike service', 'bike servicing', 'scooter service'] },
  { id: 't_chimney', name: 'Chimney cleaning', section: 'Maintenance', aliases: ['chimney', 'chimney cleaning'] },

  // Bills & Payments
  { id: 't_eb', name: 'Electricity bill', section: 'Bills & Payments', aliases: ['current bill', 'eb bill', 'electricity bill', 'electricity', 'power bill'], implied: { bill_type: 'Electricity' } },
  { id: 't_internet', name: 'Internet bill', section: 'Bills & Payments', aliases: ['internet bill', 'wifi bill', 'broadband', 'internet', 'wifi'], implied: { bill_type: 'Internet' } },
  { id: 't_phone', name: 'Phone recharge', section: 'Bills & Payments', aliases: ['recharge', 'mobile recharge', 'phone bill', 'postpaid bill'], implied: { bill_type: 'Phone' } },
  { id: 't_dth', name: 'DTH recharge', section: 'Bills & Payments', aliases: ['dth', 'tata play', 'cable bill', 'tv recharge'] },
  { id: 't_water_bill', name: 'Water bill', section: 'Bills & Payments', aliases: ['water bill'], implied: { bill_type: 'Water' } },
  { id: 't_gas_bill', name: 'Gas bill (piped)', section: 'Bills & Payments', aliases: ['gas bill', 'gas', 'piped gas'], implied: { bill_type: 'Gas' } },
  { id: 't_maintenance_bill', name: 'Society maintenance', section: 'Bills & Payments', aliases: ['maintenance', 'society maintenance', 'maintenance bill', 'maintenance charges'], implied: { bill_type: 'Maintenance' } },
  { id: 't_rent', name: 'Rent', section: 'Bills & Payments', aliases: ['rent', 'house rent'] },
  { id: 't_fees', name: 'School fees', section: 'Bills & Payments', aliases: ['school fees', 'school fee', 'tuition fees', 'fees'] },
  { id: 't_maid', name: 'Maid salary', section: 'Bills & Payments', aliases: ['maid salary', 'maid', 'cook salary', 'driver salary'] },
  { id: 't_milk_bill', name: 'Milk bill', section: 'Bills & Payments', aliases: ['milk bill', 'milkman'] },
  { id: 't_paper_bill', name: 'Newspaper bill', section: 'Bills & Payments', aliases: ['newspaper bill', 'paper bill'] },

  // Errands
  { id: 't_gas', name: 'Book gas cylinder', section: 'Errands', aliases: ['gas', 'gas cylinder', 'cylinder', 'lpg', 'book gas', 'gas booking'] },
  { id: 't_water_can', name: 'Order water can', section: 'Errands', aliases: ['water can', 'water cans', 'bisleri can'] },
  { id: 't_bank', name: 'Bank work', section: 'Errands', aliases: ['bank', 'deposit cheque', 'cheque', 'passbook'] },
  { id: 't_courier', name: 'Send / collect courier', section: 'Errands', aliases: ['courier', 'parcel'] },
  { id: 't_post', name: 'Post office', section: 'Errands', aliases: ['post office', 'speed post'] },
  { id: 't_dry_clean', name: 'Dry cleaning', section: 'Errands', aliases: ['dry cleaning', 'dry clean', 'dry cleaner'] },

  // Appointments
  { id: 't_doctor', name: 'Doctor appointment', section: 'Appointments', aliases: ['doctor', 'doctor appointment', 'clinic', 'checkup', 'check up'] },
  { id: 't_dentist', name: 'Dentist', section: 'Appointments', aliases: ['dentist', 'dental'] },
  { id: 't_eye', name: 'Eye check-up', section: 'Appointments', aliases: ['eye checkup', 'eye check up', 'eye doctor', 'spectacles'] },
  { id: 't_vaccine', name: 'Vaccination', section: 'Appointments', aliases: ['vaccination', 'vaccine', 'booster'] },
  { id: 't_ptm', name: 'Parent-teacher meeting', section: 'Appointments', aliases: ['ptm', 'parent teacher meeting', 'school meeting'] },
  { id: 't_salon', name: 'Salon', section: 'Appointments', aliases: ['salon', 'haircut', 'parlour', 'parlor'] },

  // Tickets
  { id: 't_train', name: 'Train tickets', section: 'Tickets', aliases: ['train ticket', 'train tickets', 'tatkal', 'irctc', 'train'], implied: { mode: 'Train' } },
  { id: 't_bus', name: 'Bus tickets', section: 'Tickets', aliases: ['bus ticket', 'bus tickets', 'redbus'], implied: { mode: 'Bus' } },
  { id: 't_flight', name: 'Flight tickets', section: 'Tickets', aliases: ['flight', 'flight ticket', 'flight tickets', 'air ticket'], implied: { mode: 'Flight' } },

  // Household Chores
  { id: 't_laundry', name: 'Laundry', section: 'Household Chores', aliases: ['laundry', 'wash clothes', 'washing clothes'] },
  { id: 't_ironing', name: 'Ironing', section: 'Household Chores', aliases: ['ironing', 'iron clothes', 'press clothes', 'istri'] },
  { id: 't_clean', name: 'Clean the house', section: 'Household Chores', aliases: ['clean the house', 'cleaning', 'deep clean', 'sweep', 'mop'] },
  { id: 't_plants', name: 'Water the plants', section: 'Household Chores', aliases: ['water the plants', 'plants'] },
  { id: 't_garbage', name: 'Take out the garbage', section: 'Household Chores', aliases: ['garbage', 'trash', 'dustbin'] },
];
