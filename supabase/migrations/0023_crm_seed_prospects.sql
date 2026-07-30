-- =============================================================================
-- Hartwell Pulse - 0023 CRM seed: Defence Industry Development Grant recipients
-- 59 companies and 67 grants, announced late July 2026, parsed from the
-- official PDF. Every company lands at stage 'researched': the grant data is
-- captured but nothing has been verified against their site yet.
--
-- The grant purpose is the load-bearing field. It is the public sentence
-- describing exactly what each company was funded to build, which is what makes
-- an approach specific rather than generic.
--
-- Two statements, both guarded with "where not exists" rather than "on
-- conflict". Inferring an index from an expression like lower(legal_name) is
-- the fussiest thing this file could do, and it buys nothing here.
-- Run after 0022. Idempotent: re-running adds nothing.
-- =============================================================================

insert into public.crm_organisations
  (brand, legal_name, state, tier, grant_total_aud, grant_count, grant_streams, new_capability, headline_purpose)
select 'ironpeak', v.legal_name, v.state, v.tier, v.total, v.grants, v.streams, v.newcap, v.purpose
from (values
  ('KBE Pty Ltd', 'NSW', 'A', 1250000, 2, array['Exports','Sovereign Industrial Priorities']::text[], true, 'acquire a 5-axis CNC machine to upscale component manufacture for the Ghost Shark platform'),
  ('Cop-A-Mate Products Pty Ltd', 'Vic', 'A', 1089278, 2, array['Security','Sovereign Industrial Priorities']::text[], true, 'procure capital equipment to establish local manufacturing capability for mission-critical land-vehicle armour and exhaust components and supporting continuous land-vehicle production and sustainment priorities'),
  ('NH Micro Pty Ltd', 'NSW', 'A', 1059779, 2, array['Exports','Sovereign Industrial Priorities']::text[], true, 'procure an advanced 5-axis ultra-precision machining platform to establish a scalable ultra-precision manufacturing environment to enable domestic production of mission-critical ballscrew components for control actuation systems used in guided weapons platforms'),
  ('SouthernLaunch.Space Pty Ltd', 'SA', 'A', 1035600, 2, array['Security','Sovereign Industrial Priorities']::text[], true, 'acquire range safety equipment, including communication equipment and range network equipment to support test and evaluation activities'),
  ('Aurora Labs Ltd', 'WA', 'A', 1000000, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire an advanced laser powder bed fusion machine for the manufacture of propulsion systems in support of multiple capability domains'),
  ('Ferra Engineering Pty Ltd', 'Qld', 'A', 1000000, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a 5-axis computer numerical control (CNC) horizontal machining capability to support manufacturing supply into multiple guided weapons and explosive ordnance systems'),
  ('Lintek Pty. Limited', 'NSW', 'A', 1000000, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a tack bonder, lamination press, deburrer and CNC router to upgrade printed circuit board production facility in support of multiple capability domains'),
  ('Micron Manufacturing Pty. Ltd', 'NSW', 'A', 1000000, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a machining centre, tooling and associated software for the machining of advanced underwater vehicle super-structures'),
  ('Rivierra Pty Ltd', 'Vic', 'A', 1000000, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a fully integrated coating line to internalise the powder coating and wet painting of key components manufactured for land systems'),
  ('Prism Defence Pty Ltd', 'SA', 'A', 935186, 1, array['Sovereign Industrial Priorities']::text[], true, 'procure an excavator to establish a ship motion emulation facility for the test and evaluation of uncrewed aerial systems intended to operate from ships'),
  ('NDE Solutions Pty Ltd', 'SA', 'A', 916052, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire non-destructive testing equipment to expand local capability in support of continuous naval shipbuilding and sustainment.'),
  ('Century Engineering Pty Ltd', 'SA', 'A', 901557, 1, array['Sovereign Industrial Priorities']::text[], true, 'procure a large-format CNC milling machine for high-precision machining of complex and oversized components within the stringent tolerances and material requirements associated with defence-grade components for naval and land platforms'),
  ('Tynbell Sheetmetal Pty Ltd', 'SA', 'A', 871173, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire an upgraded laser cutting system to strengthen manufacturing capability in the naval and land domains'),
  ('Kennewell Pty Ltd', 'SA', 'A', 747754, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a 5-axis machining centre, vertical lift storage unit and associated equipment for manufacturing supply into infantry fighting vehicle platforms'),
  ('Able Industries Engineering Pty Ltd', 'Vic', 'A', 715855, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire robotic welding equipment, coordinate measuring machine, CNC router and power supply upgrades to enhance manufacturing capacity for land combat vehicle and continuous naval shipbuilding and sustainment programs'),
  ('Verseng Group Pty Ltd', 'SA', 'A', 651187, 1, array['Sovereign Industrial Priorities']::text[], true, 'procure robotic welding and autonomous grinding equipment to improve finishing quality and safety in the local production of defence Ground Support Equipment used in sustainment activities, including aircraft sustainment and shipbuilding programs'),
  ('Gurit Australia Pty Limited', 'Qld', 'A', 559852, 1, array['Sovereign Industrial Priorities']::text[], true, 'establish local manufacturing capability for bespoke subsea buoyancy for the Ghost Shark autonomous underwater vehicle'),
  ('B. B. Engineering Pty Ltd', 'Vic', 'A', 551390, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a 5-axis CNC machine to enhance component manufacture in support of continuous naval shipbuilding and sustainment programs'),
  ('Wessand Pty Ltd', 'Vic', 'A', 411189, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire automated garment manufacturing equipment to strengthen domestic combat uniform manufacture'),
  ('Land Air Sea Space Pty Ltd', 'NSW', 'B', 382000, 2, array['Sovereign Industrial Priorities']::text[], true, 'procure and integrate an automated inventory management system to enhance efficiency and scalability, ensuring timely delivery of cable assemblies for land, naval and guided weapons programs'),
  ('Dent Engineering Pty Ltd', 'SA', 'B', 344722, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a CNC machining centre and lathe for the manufacture of precision components for uncrewed aerial system platforms'),
  ('Protonautics Pty Ltd', 'Qld', 'B', 323877, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a high-capacity horizontal CNC machine to support the manufacture of precision components for the Redback Infantry Fighting Vehicles.'),
  ('Value Heat Treatment Pty Ltd', 'Vic', 'B', 271262, 1, array['Sovereign Industrial Priorities']::text[], true, 'purchase capital equipment to uplift the heat treatment capability for defence components across land, sea, and air platforms'),
  ('Prestige Precision Tools Pty Ltd', 'Qld', 'B', 250000, 1, array['Exports']::text[], true, 'establish the manufacturing capability of high-performance carbide tools, delivering tooling solutions that meet the stringent requirements of platforms such as the Joint Strike Fighter and other advanced weapons systems'),
  ('Skyborne Technologies Pty Ltd', 'Qld', 'B', 250000, 1, array['Exports']::text[], true, 'procure a CNC lathe and two automated electronic and avionics testing systems to support the development and integration of autonomous systems'),
  ('Specialised Solutions Pty Ltd', 'SA', 'B', 243450, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a robotic welding cell and a 10-tonne overhead crane to manufacture high-precision welded components for small and larger modular assemblies used in naval, land and autonomous systems'),
  ('Process Rubber & Plastics Pty. Ltd', 'SA', 'B', 215829, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a 5-axis machining centre to increase manufacturing capability for multiple capability domains'),
  ('Coastal Aviation Pty Ltd', 'Qld', 'B', 198605, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a 5-axis CNC milling machine and fabrication equipment to enhance manufacturing of large defence components for air and guided-weapons platforms'),
  ('Jehbco Manufacturing Pty Ltd', 'NSW', 'B', 192264, 1, array['Sovereign Industrial Priorities']::text[], true, 'purchase a silicone rubber extruder to increase production capacity, improve dimensional accuracy, and enable the manufacture of high-performance silicone profiles for defence sealing and insulation applications across multiple platforms'),
  ('Rosebank Engineering Pty Ltd', 'Vic', 'B', 185897, 1, array['Sovereign Industrial Priorities']::text[], true, 'procure and integrate a purpose-built cold spray facility with advanced robotic control to support the manufacture of the landing gear for the MQ-28 Ghost Bat'),
  ('Currawong Engineering Pty Ltd', 'Tas', 'B', 184659, 1, array['Exports']::text[], true, 'procure a vertical machining centre to enhance the manufacture of aerospace-grade electronic speed controllers and engines to support the growing demand from export supply chains'),
  ('Luminact Pty Ltd', 'Vic', 'B', 142818, 1, array['Exports']::text[], true, 'acquire equipment and commission a transportable Command, Control, Communications, and Computers (C4) Systems Integration Lab to integrate and verify communications, networking, and battlespace management systems, to support repeatable testing and evaluation for land platforms'),
  ('Micca Holdings Pty Ltd', 'NT', 'B', 112419, 2, array['Skilling','Sovereign Industrial Priorities']::text[], true, 'acquire a rotary fibre laser cutting machine and a laser welding machine to uplift naval sustainment capability in Northern Australia.'),
  ('Stahl Metall Pty Ltd', 'Vic', 'B', 112272, 1, array['Exports']::text[], true, 'procure automated machinery and quality control equipment to support export opportunities establishing automated wire processing for high performance electrical assemblies used within multiple defence platforms'),
  ('Rheon Systems Pty Ltd', 'Qld', 'C', 90402, 1, array['Sovereign Industrial Priorities']::text[], true, 'procure capital equipment to establish NATA-accredited pressure testing and calibration capability to support test, evaluation and certification activities of Defence systems'),
  ('Electronic & Electrical Solutions Pty Ltd', 'Qld', 'C', 73115, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire capital equipment to enhance the capacity and quality of manufacturing PCBs used across multiple defence platforms, particularly for guided-weapons production and the sustainment and enhancement of combined-arms land systems'),
  ('Amtech Precision Pty Ltd', 'ACT', 'C', 69750, 1, array['Sovereign Industrial Priorities']::text[], true, 'acquire a coordinate measuring machine and profile projector to enhance precision machining manufacturing capability in support of multiple capability domains'),
  ('Ron Allum Deepsea Services Pty Ltd', 'NSW', 'C', 57634, 2, array['Exports','Skilling']::text[], true, 'upgrade its subsea test and evaluation system to support safe, repeatable, and production-scale testing of subsea systems; and obtain relevant ISO certification to remove export barriers'),
  ('Arlula Pty Ltd', 'NSW', 'C', 56014, 1, array['Exports']::text[], true, 'achieve ISO27001, ISO 9001, and general data protection regulation certification to enable the secure handling of satellite data and overcome existing export barriers to access defence markets in US and Europe'),
  ('Blueroom Simulations Pty Ltd', 'Vic', 'C', 45800, 1, array['Exports']::text[], true, 'upgrade its mixed reality testing laboratory to allow personnel to develop complex skills through immersive and realistic virtual training environments and to leverage export opportunities'),
  ('U-Neek Bending Co. Pty Ltd', 'Vic', 'C', 34526, 1, array['Exports']::text[], true, 'obtain NADCAP certification and acquire advanced welding equipment to enhance the manufacture of critical welded components to support supply chains across aerospace, land and maritime domains.'),
  ('Thrust Maritime Pty Ltd', 'Vic', 'D', 240116, 1, array['Skilling']::text[], false, 'upskill its workforce in multiple technical and trade disciplines to ensure compliance with RAN and international standards'),
  ('JFD Australia Pty Ltd', 'WA', 'D', 200000, 2, array['Security']::text[], false, 'uplift governance, physical and cybersecurity posture to meet Defence security requirements'),
  ('PHM Technology Pty Ltd', 'Vic', 'D', 100000, 1, array['Security']::text[], false, 'uplift cybersecurity controls and enhance physical security to meet Defence security requirements'),
  ('Redarc Defence & Space Pty Ltd', 'SA', 'D', 100000, 1, array['Security']::text[], false, 'uplift physical security to meet Defence security requirements'),
  ('HIFraser Pty Ltd', 'NSW', 'D', 91294, 1, array['Security']::text[], false, 'uplift physical security to meet Defence security requirements'),
  ('Lunar Outpost Oceania Pty Ltd', 'Vic', 'D', 85990, 1, array['Security']::text[], false, 'enhance Essential Eight security controls and uplift physical security to meet Defence security requirements'),
  ('Ascent Professional Services Pty Ltd', 'SA', 'D', 84419, 1, array['Security']::text[], false, 'enhance cybersecurity maturity in order to meet Defence Security requirements'),
  ('APV Engineering and Testing Services Pty Ltd', 'Vic', 'D', 83746, 1, array['Security']::text[], false, 'uplift cybersecurity controls to meet Defence security requirements'),
  ('Automation and Process Control Services Pty Ltd', 'SA', 'D', 51250, 1, array['Security']::text[], false, 'uplift cybersecurity controls to meet Defence security requirements'),
  ('Switchmode Power Supplies Pty Ltd', 'NSW', 'D', 38864, 1, array['Security']::text[], false, 'uplift security controls to meet Defence security requirements'),
  ('Bastion Defence Consulting Pty Ltd', 'SA', 'D', 34550, 1, array['Skilling']::text[], false, 'upskill engineering personnel in model-based architectural design, requirements management, and virtual verification and validation'),
  ('Applied Virtual Simulation Pty Ltd', 'NSW', 'D', 32623, 1, array['Security']::text[], false, 'uplift physical security to meet Defence security requirements'),
  ('AST Oceanics Pty Ltd', 'WA', 'D', 28367, 1, array['Security']::text[], false, 'uplift cybersecurity controls to meet Defence security requirements'),
  ('Mellori Solutions Pty Ltd', 'NSW', 'D', 24968, 1, array['Security']::text[], false, 'uplift physical security to meet Defence security requirements'),
  ('Hargo Engineering Pty Ltd', 'Vic', 'D', 20000, 1, array['Skilling']::text[], false, 'upskill staff through on-the-job training of apprentices leading to a Certificate III in Engineering - Mechanical Trade'),
  ('Consunet Pty Ltd', 'SA', 'D', 16346, 1, array['Security']::text[], false, 'uplift cybersecurity controls to meet Defence security requirements.'),
  ('Huber & Suhner (Australia) Pty Ltd', 'NSW', 'D', 6572, 1, array['Skilling']::text[], false, 'develop staff through on-the-job training in cable and harness manufacturing and inspection'),
  ('SYPAQ Systems Pty Ltd', 'Vic', 'D', 6315, 1, array['Skilling']::text[], false, 'develop workforce capability in electronic warfare')
) as v(legal_name, state, tier, total, grants, streams, newcap, purpose)
where not exists (
  select 1 from public.crm_organisations o
  where o.brand = 'ironpeak' and lower(o.legal_name) = lower(v.legal_name)
);

-- One statement for all 67 grants: a values list joined onto the companies.
insert into public.crm_grants (organisation_id, amount, stream, purpose)
select o.id, v.amount, v.stream, v.purpose
from (values
  ('Aurora Labs Ltd', 1000000, 'Sovereign Industrial Priorities', 'acquire an advanced laser powder bed fusion machine for the manufacture of propulsion systems in support of multiple capability domains'),
  ('Cop-A-Mate Products Pty Ltd', 1000000, 'Sovereign Industrial Priorities', 'procure capital equipment to establish local manufacturing capability for mission-critical land-vehicle armour and exhaust components and supporting continuous land-vehicle production and sustainment priorities'),
  ('Ferra Engineering Pty Ltd', 1000000, 'Sovereign Industrial Priorities', 'acquire a 5-axis computer numerical control (CNC) horizontal machining capability to support manufacturing supply into multiple guided weapons and explosive ordnance systems'),
  ('KBE Pty Ltd', 1000000, 'Sovereign Industrial Priorities', 'acquire a 5-axis CNC machine to upscale component manufacture for the Ghost Shark platform'),
  ('Lintek Pty. Limited', 1000000, 'Sovereign Industrial Priorities', 'acquire a tack bonder, lamination press, deburrer and CNC router to upgrade printed circuit board production facility in support of multiple capability domains'),
  ('Micron Manufacturing Pty. Ltd', 1000000, 'Sovereign Industrial Priorities', 'acquire a machining centre, tooling and associated software for the machining of advanced underwater vehicle super-structures'),
  ('Rivierra Pty Ltd', 1000000, 'Sovereign Industrial Priorities', 'acquire a fully integrated coating line to internalise the powder coating and wet painting of key components manufactured for land systems'),
  ('SouthernLaunch.Space Pty Ltd', 1000000, 'Sovereign Industrial Priorities', 'acquire range safety equipment, including communication equipment and range network equipment to support test and evaluation activities'),
  ('Prism Defence Pty Ltd', 935186, 'Sovereign Industrial Priorities', 'procure an excavator to establish a ship motion emulation facility for the test and evaluation of uncrewed aerial systems intended to operate from ships'),
  ('NDE Solutions Pty Ltd', 916052, 'Sovereign Industrial Priorities', 'acquire non-destructive testing equipment to expand local capability in support of continuous naval shipbuilding and sustainment.'),
  ('Century Engineering Pty Ltd', 901557, 'Sovereign Industrial Priorities', 'procure a large-format CNC milling machine for high-precision machining of complex and oversized components within the stringent tolerances and material requirements associated with defence-grade components for naval and land platforms'),
  ('Tynbell Sheetmetal Pty Ltd', 871173, 'Sovereign Industrial Priorities', 'acquire an upgraded laser cutting system to strengthen manufacturing capability in the naval and land domains'),
  ('NH Micro Pty Ltd', 824779, 'Sovereign Industrial Priorities', 'procure an advanced 5-axis ultra-precision machining platform to establish a scalable ultra-precision manufacturing environment to enable domestic production of mission-critical ballscrew components for control actuation systems used in guided weapons platforms'),
  ('Kennewell Pty Ltd', 747754, 'Sovereign Industrial Priorities', 'acquire a 5-axis machining centre, vertical lift storage unit and associated equipment for manufacturing supply into infantry fighting vehicle platforms'),
  ('Able Industries Engineering Pty Ltd', 715855, 'Sovereign Industrial Priorities', 'acquire robotic welding equipment, coordinate measuring machine, CNC router and power supply upgrades to enhance manufacturing capacity for land combat vehicle and continuous naval shipbuilding and sustainment programs'),
  ('Verseng Group Pty Ltd', 651187, 'Sovereign Industrial Priorities', 'procure robotic welding and autonomous grinding equipment to improve finishing quality and safety in the local production of defence Ground Support Equipment used in sustainment activities, including aircraft sustainment and shipbuilding programs'),
  ('Gurit Australia Pty Limited', 559852, 'Sovereign Industrial Priorities', 'establish local manufacturing capability for bespoke subsea buoyancy for the Ghost Shark autonomous underwater vehicle'),
  ('B. B. Engineering Pty Ltd', 551390, 'Sovereign Industrial Priorities', 'acquire a 5-axis CNC machine to enhance component manufacture in support of continuous naval shipbuilding and sustainment programs'),
  ('Wessand Pty Ltd', 411189, 'Sovereign Industrial Priorities', 'acquire automated garment manufacturing equipment to strengthen domestic combat uniform manufacture'),
  ('Dent Engineering Pty Ltd', 344722, 'Sovereign Industrial Priorities', 'acquire a CNC machining centre and lathe for the manufacture of precision components for uncrewed aerial system platforms'),
  ('Protonautics Pty Ltd', 323877, 'Sovereign Industrial Priorities', 'acquire a high-capacity horizontal CNC machine to support the manufacture of precision components for the Redback Infantry Fighting Vehicles.'),
  ('Value Heat Treatment Pty Ltd', 271262, 'Sovereign Industrial Priorities', 'purchase capital equipment to uplift the heat treatment capability for defence components across land, sea, and air platforms'),
  ('KBE Pty Ltd', 250000, 'Exports', 'procure automated machinery to expand its advanced manufacturing capability and achieve AS9100D certification to support defence and aerospace export supply chains'),
  ('Prestige Precision Tools Pty Ltd', 250000, 'Exports', 'establish the manufacturing capability of high-performance carbide tools, delivering tooling solutions that meet the stringent requirements of platforms such as the Joint Strike Fighter and other advanced weapons systems'),
  ('Skyborne Technologies Pty Ltd', 250000, 'Exports', 'procure a CNC lathe and two automated electronic and avionics testing systems to support the development and integration of autonomous systems'),
  ('Specialised Solutions Pty Ltd', 243450, 'Sovereign Industrial Priorities', 'acquire a robotic welding cell and a 10-tonne overhead crane to manufacture high-precision welded components for small and larger modular assemblies used in naval, land and autonomous systems'),
  ('Thrust Maritime Pty Ltd', 240116, 'Skilling', 'upskill its workforce in multiple technical and trade disciplines to ensure compliance with RAN and international standards'),
  ('NH Micro Pty Ltd', 235000, 'Exports', 'procure an ultra-precision coordinate measuring machine to scale up the production and export of critical Control Actuation System and in-space propulsion components to support guided weapons programs'),
  ('Process Rubber & Plastics Pty. Ltd', 215829, 'Sovereign Industrial Priorities', 'acquire a 5-axis machining centre to increase manufacturing capability for multiple capability domains'),
  ('Land Air Sea Space Pty Ltd', 212652, 'Sovereign Industrial Priorities', 'procure and integrate an automated inventory management system to enhance efficiency and scalability, ensuring timely delivery of cable assemblies for land, naval and guided weapons programs'),
  ('Coastal Aviation Pty Ltd', 198605, 'Sovereign Industrial Priorities', 'acquire a 5-axis CNC milling machine and fabrication equipment to enhance manufacturing of large defence components for air and guided-weapons platforms'),
  ('Jehbco Manufacturing Pty Ltd', 192264, 'Sovereign Industrial Priorities', 'purchase a silicone rubber extruder to increase production capacity, improve dimensional accuracy, and enable the manufacture of high-performance silicone profiles for defence sealing and insulation applications across multiple platforms'),
  ('Rosebank Engineering Pty Ltd', 185897, 'Sovereign Industrial Priorities', 'procure and integrate a purpose-built cold spray facility with advanced robotic control to support the manufacture of the landing gear for the MQ-28 Ghost Bat'),
  ('Currawong Engineering Pty Ltd', 184659, 'Exports', 'procure a vertical machining centre to enhance the manufacture of aerospace-grade electronic speed controllers and engines to support the growing demand from export supply chains'),
  ('Land Air Sea Space Pty Ltd', 169348, 'Sovereign Industrial Priorities', 'acquire electric stripping machines, cutting and crimping tools, and associated equipment to expand production capacity for supply into various land and naval platforms'),
  ('Luminact Pty Ltd', 142818, 'Exports', 'acquire equipment and commission a transportable Command, Control, Communications, and Computers (C4) Systems Integration Lab to integrate and verify communications, networking, and battlespace management systems, to support repeatable testing and evaluation for land platforms'),
  ('Stahl Metall Pty Ltd', 112272, 'Exports', 'procure automated machinery and quality control equipment to support export opportunities establishing automated wire processing for high performance electrical assemblies used within multiple defence platforms'),
  ('JFD Australia Pty Ltd', 100000, 'Security', 'uplift governance, physical and cybersecurity posture to meet Defence security requirements'),
  ('JFD Australia Pty Ltd', 100000, 'Security', 'uplift physical security to meet Defence security requirements'),
  ('PHM Technology Pty Ltd', 100000, 'Security', 'uplift cybersecurity controls and enhance physical security to meet Defence security requirements'),
  ('Redarc Defence & Space Pty Ltd', 100000, 'Security', 'uplift physical security to meet Defence security requirements'),
  ('HIFraser Pty Ltd', 91294, 'Security', 'uplift physical security to meet Defence security requirements'),
  ('Rheon Systems Pty Ltd', 90402, 'Sovereign Industrial Priorities', 'procure capital equipment to establish NATA-accredited pressure testing and calibration capability to support test, evaluation and certification activities of Defence systems'),
  ('Cop-A-Mate Products Pty Ltd', 89278, 'Security', 'uplift physical and ICT security to meet Defence security requirements'),
  ('Lunar Outpost Oceania Pty Ltd', 85990, 'Security', 'enhance Essential Eight security controls and uplift physical security to meet Defence security requirements'),
  ('Ascent Professional Services Pty Ltd', 84419, 'Security', 'enhance cybersecurity maturity in order to meet Defence Security requirements'),
  ('APV Engineering and Testing Services Pty Ltd', 83746, 'Security', 'uplift cybersecurity controls to meet Defence security requirements'),
  ('Electronic & Electrical Solutions Pty Ltd', 73115, 'Sovereign Industrial Priorities', 'acquire capital equipment to enhance the capacity and quality of manufacturing PCBs used across multiple defence platforms, particularly for guided-weapons production and the sustainment and enhancement of combined-arms land systems'),
  ('Amtech Precision Pty Ltd', 69750, 'Sovereign Industrial Priorities', 'acquire a coordinate measuring machine and profile projector to enhance precision machining manufacturing capability in support of multiple capability domains'),
  ('Micca Holdings Pty Ltd', 62419, 'Sovereign Industrial Priorities', 'acquire a rotary fibre laser cutting machine and a laser welding machine to uplift naval sustainment capability in Northern Australia.'),
  ('Arlula Pty Ltd', 56014, 'Exports', 'achieve ISO27001, ISO 9001, and general data protection regulation certification to enable the secure handling of satellite data and overcome existing export barriers to access defence markets in US and Europe'),
  ('Ron Allum Deepsea Services Pty Ltd', 51609, 'Exports', 'upgrade its subsea test and evaluation system to support safe, repeatable, and production-scale testing of subsea systems; and obtain relevant ISO certification to remove export barriers'),
  ('Automation and Process Control Services Pty Ltd', 51250, 'Security', 'uplift cybersecurity controls to meet Defence security requirements'),
  ('Micca Holdings Pty Ltd', 50000, 'Skilling', 'upskill staff through on-the-job training and the supervision of apprentices to support naval maintenance activities'),
  ('Blueroom Simulations Pty Ltd', 45800, 'Exports', 'upgrade its mixed reality testing laboratory to allow personnel to develop complex skills through immersive and realistic virtual training environments and to leverage export opportunities'),
  ('Switchmode Power Supplies Pty Ltd', 38864, 'Security', 'uplift security controls to meet Defence security requirements'),
  ('SouthernLaunch.Space Pty Ltd', 35600, 'Security', 'enhance Essential Eight security controls to meet Defence security requirements'),
  ('Bastion Defence Consulting Pty Ltd', 34550, 'Skilling', 'upskill engineering personnel in model-based architectural design, requirements management, and virtual verification and validation'),
  ('U-Neek Bending Co. Pty Ltd', 34526, 'Exports', 'obtain NADCAP certification and acquire advanced welding equipment to enhance the manufacture of critical welded components to support supply chains across aerospace, land and maritime domains.'),
  ('Applied Virtual Simulation Pty Ltd', 32623, 'Security', 'uplift physical security to meet Defence security requirements'),
  ('AST Oceanics Pty Ltd', 28367, 'Security', 'uplift cybersecurity controls to meet Defence security requirements'),
  ('Mellori Solutions Pty Ltd', 24968, 'Security', 'uplift physical security to meet Defence security requirements'),
  ('Hargo Engineering Pty Ltd', 20000, 'Skilling', 'upskill staff through on-the-job training of apprentices leading to a Certificate III in Engineering - Mechanical Trade'),
  ('Consunet Pty Ltd', 16346, 'Security', 'uplift cybersecurity controls to meet Defence security requirements.'),
  ('Huber & Suhner (Australia) Pty Ltd', 6572, 'Skilling', 'develop staff through on-the-job training in cable and harness manufacturing and inspection'),
  ('SYPAQ Systems Pty Ltd', 6315, 'Skilling', 'develop workforce capability in electronic warfare'),
  ('Ron Allum Deepsea Services Pty Ltd', 6025, 'Skilling', 'upskill technical personnel in software coding and systems engineering to enhance in-house design and production capabilities for defence projects')
) as v(company, amount, stream, purpose)
join public.crm_organisations o
  on o.brand = 'ironpeak' and lower(o.legal_name) = lower(v.company)
where not exists (
  select 1 from public.crm_grants g
  where g.organisation_id = o.id and g.purpose = v.purpose
);
