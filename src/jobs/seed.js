const crypto = require('crypto');
const { connectDB, disconnectDB } = require('../config/db');
const Company = require('../models/Company');
const Job = require('../models/Job');
const User = require('../models/User');

const seedData = async () => {
  try {
    console.log('🌱 Starting MongoDB Atlas Database Seeding...');
    await connectDB();

    // 1. Create a system/admin user for company ownership if none exists
    let adminUser = await User.findOne({ email: 'system@careeros.ai' });
    if (!adminUser) {
      adminUser = await User.create({
        email: 'system@careeros.ai',
        passwordHash: '$2a$12$e80M5YQ7h5F6.Q8r1t0kXeU4k.2B5p2W4zK9t1Z1l0l2a3b4c5d6e',
        role: 'admin',
        status: 'active',
        emailVerified: true,
      });
      console.log('✅ Created system owner user: system@careeros.ai');
    }

    // 2. Verified Companies Data
    const companiesData = [
      {
        name: 'Stripe',
        domain: 'stripe.com',
        verified: true,
        status: 'active',
        careersUrl: 'https://stripe.com/jobs',
        logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop&q=80',
        industry: 'Financial Technology / Payments',
        location: 'San Francisco, CA & Remote',
        companySize: '1000+',
        description: 'Stripe is a financial infrastructure platform for the internet. Millions of companies use Stripe to accept payments, grow their revenue, and accelerate new business opportunities.',
      },
      {
        name: 'Vercel',
        domain: 'vercel.com',
        verified: true,
        status: 'active',
        careersUrl: 'https://vercel.com/careers',
        logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop&q=80',
        industry: 'Developer Tools & Cloud',
        location: 'Remote Global',
        companySize: '501-1000',
        description: 'Vercel provides the developer experience and infrastructure to build, scale, and secure a faster, more personalized web. Creators of Next.js.',
      },
      {
        name: 'Datadog',
        domain: 'datadoghq.com',
        verified: true,
        status: 'active',
        careersUrl: 'https://datadoghq.com/careers',
        logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop&q=80',
        industry: 'Cloud Monitoring & Observability',
        location: 'New York, NY / Hybrid',
        companySize: '1000+',
        description: 'Datadog is an essential monitoring and security platform for cloud applications, combining metrics, traces, and logs for end-to-end observability.',
      },
      {
        name: 'Anthropic',
        domain: 'anthropic.com',
        verified: true,
        status: 'active',
        careersUrl: 'https://anthropic.com/careers',
        logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop&q=80',
        industry: 'Artificial Intelligence Research',
        location: 'San Francisco, CA & Hybrid',
        companySize: '201-500',
        description: 'Anthropic is an AI safety and research company that builds reliable, beneficial, and interpretable AI systems including Claude.',
      },
      {
        name: 'Razorpay',
        domain: 'razorpay.com',
        verified: true,
        status: 'active',
        careersUrl: 'https://razorpay.com/jobs',
        logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&h=100&fit=crop&q=80',
        industry: 'Fintech / Banking API',
        location: 'Bengaluru, India / Hybrid',
        companySize: '1000+',
        description: 'Razorpay is India’s leading full-stack financial solutions company powering merchant payments, neobanking, and business capital.',
      },
    ];

    const companyMap = {};
    for (const cData of companiesData) {
      const company = await Company.findOneAndUpdate(
        { domain: cData.domain },
        { ...cData, ownerUserId: adminUser._id },
        { upsert: true, new: true }
      );
      companyMap[cData.name] = company;
      console.log(`🏢 Seeded company: ${company.name} (${company.domain})`);
    }

    // Helper to generate SHA-256 fingerprint
    const createFingerprint = (companyId, title, location) => {
      return crypto
        .createHash('sha256')
        .update(`${companyId}_${title.toLowerCase().trim()}_${location.toLowerCase().trim()}`)
        .digest('hex');
    };

    // 3. Verified Engineering Jobs Data
    const jobsData = [
      {
        company: 'Stripe',
        title: 'Senior Full-Stack Engineer, Connect Platform',
        location: 'San Francisco, CA / Remote',
        workMode: 'remote',
        employmentType: 'FULL_TIME',
        experienceMin: 4,
        experienceMax: 8,
        skills: ['typescript', 'react', 'next.js', 'node.js', 'postgresql', 'aws', 'rest api', 'distributed systems'],
        salary: { min: 175000, max: 225000, currency: 'USD', isDisclosed: true },
        description: `### About the Role
Stripe Connect is the fastest and easiest way to integrate payments into software platforms and marketplaces. As a Senior Full-Stack Engineer, you will design, build, and maintain mission-critical payment workflows used by millions of businesses.

### Key Responsibilities
- Architect resilient, low-latency APIs and web applications handling high transaction volumes.
- Collaborate with product designers and frontend teams to build intuitive merchant onboarding flows.
- Champion code quality, comprehensive automated integration testing, and operational observability.

### Minimum Qualifications
- 4+ years of professional full-stack web engineering experience.
- Strong proficiency in modern TypeScript/JavaScript, React/Next.js, and Node.js backend services.
- Solid experience with relational databases (PostgreSQL) and distributed event systems.`,
        applicationUrl: 'https://stripe.com/jobs/senior-full-stack-connect',
        sourceType: 'ingested',
      },
      {
        company: 'Vercel',
        title: 'Frontend Infrastructure Architect',
        location: 'Remote Global',
        workMode: 'remote',
        employmentType: 'FULL_TIME',
        experienceMin: 5,
        experienceMax: 10,
        skills: ['react', 'next.js', 'typescript', 'tailwind css', 'web performance', 'edge computing'],
        salary: { min: 185000, max: 240000, currency: 'USD', isDisclosed: true },
        description: `### Overview
At Vercel, we empower the world to build the modern web. We are seeking a Frontend Infrastructure Architect to lead advancements in our Next.js dashboard, edge rendering patterns, and client-side performance.

### Responsibilities
- Design scalable, accessible component design systems using Tailwind CSS and Radix primitives.
- Optimize web vitals (LCP, INP, CLS) across large-scale single page and server-rendered applications.
- Develop developer-facing telemetry and real-time analytics visualizations.

### Qualifications
- Deep mastery of React internals, Next.js App Router, and server components.
- Passion for pristine UX polish, keyboard accessibility, and state management.`,
        applicationUrl: 'https://vercel.com/careers/frontend-architect',
        sourceType: 'ingested',
      },
      {
        company: 'Datadog',
        title: 'Backend Systems Engineer, Cloud Observability',
        location: 'New York, NY',
        workMode: 'hybrid',
        employmentType: 'FULL_TIME',
        experienceMin: 3,
        experienceMax: 6,
        skills: ['go', 'node.js', 'python', 'distributed systems', 'kafka', 'mongodb', 'docker', 'kubernetes'],
        salary: { min: 160000, max: 210000, currency: 'USD', isDisclosed: true },
        description: `### Team Description
Our Cloud Observability team builds data ingestion engines capable of processing billions of events per minute. We seek a Backend Systems Engineer to scale our stream-processing and indexing pipelines.

### What You'll Do
- Build high-throughput, low-latency microservices with Go and Node.js.
- Ensure 99.99% availability of telemetry ingestion with robust backpressure and dead-letter queues.
- Implement automated regression testing and performance benchmarks.

### Requirements
- 3+ years experience engineering distributed backend systems.
- Experience with queuing systems (Kafka, RabbitMQ) and document/time-series databases.`,
        applicationUrl: 'https://datadoghq.com/careers/backend-systems-engineer',
        sourceType: 'ingested',
      },
      {
        company: 'Anthropic',
        title: 'AI Platform Engineer, Tool Calling & Agentic Runtimes',
        location: 'San Francisco, CA',
        workMode: 'hybrid',
        employmentType: 'FULL_TIME',
        experienceMin: 4,
        experienceMax: 8,
        skills: ['python', 'typescript', 'node.js', 'llm agents', 'prompt engineering', 'evals', 'docker'],
        salary: { min: 210000, max: 290000, currency: 'USD', isDisclosed: true },
        description: `### Mission
Anthropic is dedicated to building safe, interpretable AI. In this role, you will build the software harness and agent execution frameworks that enable Claude to interact with external tools and APIs safely.

### Responsibilities
- Build sandboxed tool-execution runtimes with least-privilege security controls.
- Design structured JSON extraction pipelines and deterministic evaluation frameworks.
- Mitigate prompt-injection vectors and prevent unauthorized tool access.

### Desired Experience
- Strong background in Python, TypeScript, and modern API orchestration.
- Demonstrated experience deploying LLM tool-calling systems or autonomous agents in production.`,
        applicationUrl: 'https://anthropic.com/careers/ai-platform-engineer',
        sourceType: 'ingested',
      },
      {
        company: 'Razorpay',
        title: 'Lead Software Engineer - Core Banking & Payouts',
        location: 'Bengaluru, India',
        workMode: 'hybrid',
        employmentType: 'FULL_TIME',
        experienceMin: 5,
        experienceMax: 9,
        skills: ['node.js', 'express', 'mongodb', 'redis', 'microservices', 'aws', 'rest api', 'system design'],
        salary: { min: 3500000, max: 5500000, currency: 'INR', isDisclosed: true },
        description: `### Role Overview
Join Razorpay’s Payouts engineering team, powering instant disbursements for India’s fastest-growing startups and enterprises. You will lead the design and implementation of highly available financial transaction pipelines.

### Key Responsibilities
- Architect resilient microservices handling millions of API calls with idempotent request handling.
- Collaborate with product and risk teams to implement real-time fraud mitigation checks.
- Mentor junior and mid-level software developers on clean architecture and design patterns.

### Requirements
- 5+ years experience building mission-critical backend systems in Node.js, Express, or Go.
- In-depth understanding of database transactions, Redis caching, and AWS cloud architecture.`,
        applicationUrl: 'https://razorpay.com/jobs/lead-software-engineer-payouts',
        sourceType: 'company_posted',
      },
      {
        company: 'Stripe',
        title: 'Staff Security Engineer, Application & Ingestion Security',
        location: 'Remote Global',
        workMode: 'remote',
        employmentType: 'FULL_TIME',
        experienceMin: 6,
        experienceMax: 12,
        skills: ['application security', 'owasp asvs', 'ssrf defense', 'penetration testing', 'aws iam', 'cryptography'],
        salary: { min: 220000, max: 310000, currency: 'USD', isDisclosed: true },
        description: `### The Role
Stripe’s Security team safeguards global financial infrastructure. We are hiring a Staff Security Engineer to lead threat modeling, secure code design, and penetration testing for public-facing ingestion services.

### Responsibilities
- Harden external web hooks and URL fetchers against Server-Side Request Forgery (SSRF) and DNS rebinding.
- Define RBAC policies and automated audit trails adhering to OWASP ASVS standards.
- Partner with product engineering to embed security by design in early development phases.`,
        applicationUrl: 'https://stripe.com/jobs/staff-security-engineer',
        sourceType: 'ingested',
      },
    ];

    for (const jData of jobsData) {
      const company = companyMap[jData.company];
      if (!company) continue;

      const fingerprint = createFingerprint(company._id, jData.title, jData.location);

      const job = await Job.findOneAndUpdate(
        { fingerprint },
        {
          companyId: company._id,
          sourceType: jData.sourceType,
          sourceUrl: jData.applicationUrl,
          title: jData.title,
          description: jData.description,
          location: jData.location,
          workMode: jData.workMode,
          employmentType: jData.employmentType,
          experienceMin: jData.experienceMin,
          experienceMax: jData.experienceMax,
          skills: jData.skills,
          salary: jData.salary,
          status: 'active',
          fingerprint,
          applicationUrl: jData.applicationUrl,
          sourceAttribution: {
            domain: company.domain,
            verifiedSource: company.verified,
            lastCheckedAt: new Date(),
          },
          postedAt: new Date(Date.now() - Math.floor(Math.random() * 5 * 24 * 60 * 60 * 1000)), // Posted 0-5 days ago
          lastSeenAt: new Date(),
        },
        { upsert: true, new: true }
      );
      console.log(`💼 Seeded job: "${job.title}" at ${company.name} [ID: ${job._id}]`);
    }

    console.log('🎉 Database seeding completed successfully with 5 companies and 6 verified jobs!');
    await disconnectDB();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

seedData();

