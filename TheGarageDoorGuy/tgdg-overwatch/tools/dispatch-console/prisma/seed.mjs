import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tech = await prisma.technician.upsert({
    where: { hcpEmployeeId: "demo-tech-1" },
    update: {},
    create: {
      hcpEmployeeId: "demo-tech-1",
      name: "Jordan (Demo Tech)",
      active: true,
    },
  });

  await prisma.zipCoverage.upsert({
    where: { zip_technicianId: { zip: "72201", technicianId: tech.id } },
    update: {},
    create: { zip: "72201", technicianId: tech.id },
  });

  console.log(`Seeded technician ${tech.name} covering zip 72201`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
