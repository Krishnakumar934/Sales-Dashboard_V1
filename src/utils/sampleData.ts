import type { Dataset } from '../types/data.ts';
import { inferColumnTypes } from './aggregator.ts';

interface HierarchyGroup {
  gm: string;
  zone: string;
  asms: {
    asm: string;
    branches: string[];
  }[];
}

const INDIAN_BANKING_HIERARCHY: HierarchyGroup[] = [
  {
    gm: 'Rajesh Sharma',
    zone: 'West Zone',
    asms: [
      {
        asm: 'Rohit Verma',
        branches: ['Mumbai Central', 'Pune Shivaji Nagar', 'Thane Naupada'],
      },
      {
        asm: 'Amit Saxena',
        branches: ['Ahmedabad SG Highway', 'Surat Ring Road', 'Vadodara Alkapuri'],
      },
    ],
  },
  {
    gm: 'Ananya Deshmukh',
    zone: 'South Zone',
    asms: [
      {
        asm: 'Priya Iyer',
        branches: ['Bengaluru Tech Park', 'Mysuru Saraswathipuram', 'Hubballi Vidyanagar'],
      },
      {
        asm: 'Suresh Menon',
        branches: ['Hyderabad HITEC City', 'Chennai Anna Nagar', 'Coimbatore RS Puram'],
      },
    ],
  },
  {
    gm: 'Vikram Malhotra',
    zone: 'North Zone',
    asms: [
      {
        asm: 'Neha Kapoor',
        branches: ['Delhi Connaught Place', 'Noida Sector 18', 'Gurugram Cyber Hub'],
      },
      {
        asm: 'Deepak Joshi',
        branches: ['Chandigarh Tribune Chowk', 'Jaipur MI Road', 'Lucknow Hazratganj'],
      },
    ],
  },
  {
    gm: 'Sunita Nair',
    zone: 'East Zone',
    asms: [
      {
        asm: 'Swati Sen',
        branches: ['Kolkata Park Street', 'Salt Lake Sector V', 'Howrah Station Road'],
      },
      {
        asm: 'Arindam Bose',
        branches: ['Bhubaneswar Janpath', 'Patna Boring Road', 'Ranchi Main Road'],
      },
    ],
  },
];

function generateIndianBranchDataset(): Dataset {
  const categories = ['Retail Banking', 'MSME Loans', 'Commercial Credit', 'Wealth Management'];
  const rows: Record<string, any>[] = [];

  // Generate for 2025 (months 1-12) and 2026 (months 1-10: Jan through Oct)
  for (let year = 2025; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 10 : 12; // Jan through Oct for 2026 (includes Apr-Sep smoothly)
    for (let m = 1; m <= maxMonth; m++) {
      const monthStr = `${year}-${String(m).padStart(2, '0')}`;
      const baseGrowth = (year - 2025) * 12 + m;

      let branchIdx = 0;
      for (const group of INDIAN_BANKING_HIERARCHY) {
        for (const asmGroup of group.asms) {
          for (const branch of asmGroup.branches) {
            branchIdx++;
            const category = categories[(branchIdx + m) % categories.length];
            const day = 1 + ((branchIdx * 3 + m * 2) % 27);
            const date = `${monthStr}-${String(day).padStart(2, '0')}`;

            // Seasonal & realistic variance in Crores / Lakhs
            const seasonal = Math.sin((m / 12) * Math.PI * 2) * 600000;
            const randomFactor = ((branchIdx * 733 + m * 41) % 100) / 100;
            const amount = Math.round(3500000 + baseGrowth * 180000 + seasonal + randomFactor * 3200000);
            const disbursement = Math.round(amount * (0.86 + (randomFactor * 0.08)));
            const target = Math.round(amount * (0.94 + (((branchIdx + m) % 5) * 0.04)));
            const collection = Math.round(disbursement * (0.91 + (randomFactor * 0.06)));
            const count = 45 + Math.round((amount / 120000) + ((branchIdx * 5) % 30));
            const quantity = Math.round(count * 6 + ((branchIdx * 13 + m * 5) % 40));
            const discount = Math.round(amount * (0.038 + (((branchIdx + m) % 4) * 0.004)));

            rows.push({
              Date: date,
              GM: group.gm,
              ASM: asmGroup.asm,
              Branch: branch,
              Zone: group.zone,
              Category: category,
              Amount: amount,
              Quantity: quantity,
              Discount: discount,
              Disbursement: disbursement,
              Target: target,
              Collection: collection,
              'Transaction Count': count,
            });
          }
        }
      }
    }
  }

  const columns = inferColumnTypes(rows);

  return {
    id: 'sample-indian-branches',
    name: 'India Regional & Branch Operations',
    description: 'Hierarchical GM portfolio, ASM territories, branch disbursements, collections, and transaction counts in Crores (Cr).',
    sheetNames: ['Branch Summary', 'GM Portfolio', 'ASM Hierarchy'],
    activeSheet: 'Branch Summary',
    rows,
    columns,
    defaultDateCol: 'Date',
    defaultMetricCol: 'Amount',
    defaultDimCol: 'Branch',
  };
}

function generateSalesDataset(): Dataset {
  const regions = ['North America', 'EMEA', 'APAC', 'Latin America'];
  const segments = ['Enterprise', 'Mid-Market', 'SMB', 'Public Sector'];
  const products = ['Cloud Infrastructure', 'AI Copilots', 'Security Suite', 'Advisory Services'];
  const reps = ['Sarah Chen', 'Marcus Vance', 'Elena Rostova', 'Tariq Al-Mansoor', 'Chloe Dubois'];

  const rows: Record<string, any>[] = [];

  // Generate for 22 months: Jan 2025 to Oct 2026
  for (let year = 2025; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 10 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const monthStr = `${year}-${String(m).padStart(2, '0')}`;
      const baseGrowth = (year - 2025) * 12 + m; // upward growth factor

      for (let i = 0; i < 14; i++) {
        const region = regions[(i + m) % regions.length];
        const segment = segments[(i * 3 + m) % segments.length];
        const product = products[(i * 2 + m) % products.length];
        const rep = reps[(i + m * 2) % reps.length];
        const day = 1 + ((i * 3) % 27);
        const date = `${monthStr}-${String(day).padStart(2, '0')}`;

        // Baseline seasonal variance
        const seasonal = Math.sin((m / 12) * Math.PI * 2) * 8000;
        const randomFactor = ((i * 1337 + m * 31) % 100) / 100;
        const revenue = Math.round(35000 + baseGrowth * 1800 + seasonal + randomFactor * 25000);
        const units = Math.round(revenue / (180 + ((i * 19) % 80)));
        const grossMarginPct = Number((68 + ((i * 7 + m) % 18) - randomFactor * 4).toFixed(1));
        const satisfactionScore = Number((4.2 + ((i * 11) % 8) / 10).toFixed(1));

        rows.push({
          Date: date,
          Region: region,
          Segment: segment,
          'Product Line': product,
          'Account Executive': rep,
          Revenue: revenue,
          'Units Sold': units,
          'Gross Margin %': grossMarginPct,
          'Customer Score': satisfactionScore,
        });
      }
    }
  }

  const columns = inferColumnTypes(rows);

  return {
    id: 'sample-sales',
    name: 'Enterprise Revenue & Sales',
    description: 'Multi-region revenue, unit volumes, and profit margins across 22 months.',
    sheetNames: ['Sales Transactions', 'Quarterly Summary'],
    activeSheet: 'Sales Transactions',
    rows,
    columns,
    defaultDateCol: 'Date',
    defaultMetricCol: 'Revenue',
    defaultDimCol: 'Region',
  };
}

function generateExpenseDataset(): Dataset {
  const departments = ['Engineering', 'Marketing & Growth', 'Sales & Success', 'Product & Design', 'Operations & Legal'];
  const categories = ['Cloud Infrastructure & GPU', 'Payroll & Talent', 'Paid Acquisition', 'Tooling & Software', 'Travel & Events'];

  const rows: Record<string, any>[] = [];

  for (let year = 2025; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 10 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const monthStr = `${year}-${String(m).padStart(2, '0')}`;

      for (let i = 0; i < departments.length; i++) {
        const dept = departments[i];
        for (let j = 0; j < categories.length; j++) {
          const cat = categories[j];
          const day = 1 + ((i * 5 + j * 3) % 27);
          const date = `${monthStr}-${String(day).padStart(2, '0')}`;

          const baseCost = (i + 1) * 15000 + (j + 1) * 8000;
          const budget = baseCost + ((m * 17 + i * 23) % 12000);
          const noise = ((i * 99 + j * 47 + m * 13) % 6000) - 3000;
          const actual = Math.round(budget + noise);
          const variance = actual - budget;
          const headcount = 5 + (i * 8) + Math.floor(m / 3);

          rows.push({
            Date: date,
            Department: dept,
            'Expense Category': cat,
            Budget: budget,
            'Actual Spend': actual,
            Variance: variance,
            Headcount: headcount,
          });
        }
      }
    }
  }

  const columns = inferColumnTypes(rows);

  return {
    id: 'sample-expenses',
    name: 'SaaS Operating Expenses',
    description: 'Monthly department operational costs, infrastructure budget, and variances.',
    sheetNames: ['OpEx Ledger', 'Budget Plan'],
    activeSheet: 'OpEx Ledger',
    rows,
    columns,
    defaultDateCol: 'Date',
    defaultMetricCol: 'Actual Spend',
    defaultDimCol: 'Department',
  };
}

function generateSupplyChainDataset(): Dataset {
  const routes = ['Trans-Pacific Express', 'North Atlantic Corridor', 'Intra-Asia Circuit', 'Latin America Coastal'];
  const carriers = ['Maersk Line', 'Hapag-Lloyd', 'MSC Mediterranean', 'Evergreen Marine'];
  const commodities = ['Consumer Electronics', 'Industrial Machinery', 'Automotive Parts', 'Pharmaceuticals'];

  const rows: Record<string, any>[] = [];

  for (let year = 2025; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 10 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const monthStr = `${year}-${String(m).padStart(2, '0')}`;

      for (let i = 0; i < 12; i++) {
        const route = routes[(i + m) % routes.length];
        const carrier = carriers[(i * 2 + m) % carriers.length];
        const cargo = commodities[(i * 3 + m) % commodities.length];
        const day = 1 + ((i * 4) % 26);
        const date = `${monthStr}-${String(day).padStart(2, '0')}`;

        const teu = 150 + ((i * 83 + m * 37) % 650);
        const freightCost = teu * (420 + ((i * 13) % 180));
        const onTimeRate = Number((82 + ((i * 7 + m * 5) % 16)).toFixed(1));
        const transitDays = 12 + ((i * 3) % 14);

        rows.push({
          Date: date,
          'Trade Route': route,
          Carrier: carrier,
          'Cargo Commodity': cargo,
          'TEU Volume': teu,
          'Freight Cost': freightCost,
          'On-Time Rate %': onTimeRate,
          'Transit Days': transitDays,
        });
      }
    }
  }

  const columns = inferColumnTypes(rows);

  return {
    id: 'sample-supply-chain',
    name: 'Global Freight & Supply Chain',
    description: 'Cargo routes, freight container costs, and delivery reliability metrics.',
    sheetNames: ['Shipment Log', 'Carrier Scorecard'],
    activeSheet: 'Shipment Log',
    rows,
    columns,
    defaultDateCol: 'Date',
    defaultMetricCol: 'Freight Cost',
    defaultDimCol: 'Trade Route',
  };
}

function generateFinanceDataset(): Dataset {
  const financiers = ['IDFC FINANCE', 'BAJAJ FINSERV', 'HDFC BANK', 'HDB FINANCIAL', 'TVS CREDIT'];
  const categories = ['HOME APPLIANCES', 'MOBILE & TABLET', 'CONSUMER ELECTRONICS', 'ACCESSORIES'];
  const brands = ['OPPO', 'Samsung', 'Haier', 'Apple', 'V-GUARD', 'BOAT'];
  const rows: Record<string, any>[] = [];

  for (let m = 4; m <= 10; m++) {
    const monthDate = `2026-${String(m).padStart(2, '0')}-01`;
    let branchIdx = 0;
    for (const group of INDIAN_BANKING_HIERARCHY) {
      for (const asmGroup of group.asms) {
        for (const branch of asmGroup.branches) {
          branchIdx++;
          const financier = financiers[(branchIdx + m) % financiers.length];
          const category = categories[(branchIdx * 2 + m) % categories.length];
          const brand = brands[(branchIdx + m * 2) % brands.length];
          const invNum = `26-SI-${branch.slice(0, 3).toUpperCase()}-${String(m * 100 + branchIdx)}`;
          const loanAmt = 12500 + ((branchIdx * 31 + m * 17) % 28) * 1500;

          rows.push({
            Branch: branch,
            'Invoice Number': invNum,
            Category: category,
            Brand: brand,
            Qty: 1,
            'Invoice Count': 1,
            Financier: financier,
            'Loan Amount': loanAmt,
            Count: 1,
            Month: monthDate,
            GM: group.gm,
            ASM: asmGroup.asm,
          });

          // Multi-item second row on every 4th invoice (Count is blank '' just like live Finance Data)
          if (branchIdx % 4 === 0) {
            rows.push({
              Branch: branch,
              'Invoice Number': invNum,
              Category: 'ACCESSORIES',
              Brand: 'BOAT',
              Qty: 1,
              'Invoice Count': 1,
              Financier: financier,
              'Loan Amount': 1799,
              Count: '',
              Month: monthDate,
              GM: group.gm,
              ASM: asmGroup.asm,
            });
          }
        }
      }
    }
  }

  const columns = inferColumnTypes(rows);

  return {
    id: 'sample-finance-data',
    name: 'Finance Data',
    description: 'Storewise finance loans by Financier, GM, ASM, Category, and Brand (Loan Amount & Count).',
    sheetNames: ['Sales Report', 'Finance Data'],
    activeSheet: 'Finance Data',
    reportType: 'finance',
    rows,
    columns,
    defaultDateCol: 'Month',
    defaultMetricCol: 'Loan Amount',
    defaultDimCol: 'Financier',
    defaultCountCol: 'Count',
  };
}

export const SAMPLE_DATASETS: Dataset[] = [
  {
    ...generateIndianBranchDataset(),
    reportType: 'sales',
  },
  generateFinanceDataset(),
  generateSalesDataset(),
  generateExpenseDataset(),
  generateSupplyChainDataset(),
];
